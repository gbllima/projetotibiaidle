import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { HuntSession, SimEvent } from '@tibia-idle/sim';
import type { Database } from './db.js';
import { loadCharacter } from './game.js';
import { economyCharacterView, syncAccountEconomy } from './economy.js';
import { markOffline, markOnline } from './presence.js';
import { publicSettlement } from './settle.js';

/**
 * Live session updates.
 *
 * The browser runs its own copy of the simulation for animation, so this socket
 * carries state snapshots rather than a blow-by-blow event stream. A snapshot
 * every couple of seconds is enough to correct any drift and costs a fraction
 * of the bandwidth, and because both sides run the same deterministic code from
 * the same seed there is normally nothing to correct.
 */

const PUSH_INTERVAL_MS = 2000;
const PARTY_UID_STRIDE = 10_000_000;

interface Subscription {
  socket: WebSocket;
  accountId: number;
  characterId: number;
  timer: NodeJS.Timeout;
}

type PartyMemberView = {
  id: number;
  self?: boolean;
  active?: boolean;
};

type PartyMonsterView = {
  uid: number;
  monsterId: string;
  health: number;
  maxHealth: number;
  tileX?: number;
  tileY?: number;
  paralyzed?: boolean;
};

function namespacedPartyUid(memberId: number, uid: number): number {
  return memberId * PARTY_UID_STRIDE + Math.abs(Math.trunc(uid)) % PARTY_UID_STRIDE;
}

function parseActivePartySessions(
  db: Database,
  accountId: number,
  principalId: number,
  huntId: string | undefined,
  party: PartyMemberView[],
): Map<number, HuntSession> {
  const sessions = new Map<number, HuntSession>();
  if (!huntId) return sessions;

  for (const member of party) {
    if (member.self || member.id === principalId || member.active === false) continue;
    const row = db.findCharacter(member.id);
    if (!row || row.accountId !== accountId || !row.session) continue;
    try {
      const session = JSON.parse(row.session) as HuntSession;
      if (session.status !== 'active' || session.huntId !== huntId) continue;
      sessions.set(member.id, session);
    } catch {
      // A malformed secondary snapshot must not break the principal socket.
    }
  }
  return sessions;
}

function partyMonsterSnapshot(sessions: Map<number, HuntSession>): PartyMonsterView[] {
  const monsters: PartyMonsterView[] = [];
  for (const [memberId, session] of sessions) {
    for (const monster of session.active ?? []) {
      monsters.push({
        uid: namespacedPartyUid(memberId, monster.uid),
        monsterId: monster.monsterId,
        health: monster.health,
        maxHealth: monster.maxHealth,
        tileX: monster.tileX,
        tileY: monster.tileY,
        paralyzed: (monster.paralyzeTicks ?? 0) > 0,
      });
    }
  }
  return monsters;
}

function actualPartyMonsterUid(session: HuntSession, event: SimEvent): number | undefined {
  const active = session.active ?? [];
  if (active.length === 0) return event.uid;

  if (event.monsterId) {
    const exact = active.find((monster) => monster.uid === event.uid && monster.monsterId === event.monsterId);
    if (exact) return exact.uid;
    const sameType = active.find((monster) => monster.monsterId === event.monsterId);
    if (sameType) return sameType.uid;
  }

  const rawMatch = active.find((monster) => monster.uid === event.uid);
  return rawMatch?.uid ?? active[0]?.uid ?? event.uid;
}

function remapPartyEvents(
  events: SimEvent[],
  principalId: number,
  sessions: Map<number, HuntSession>,
): SimEvent[] {
  return events
    // The principal's events already arrive in the normal settlement stream.
    // Keeping them here duplicates attack words, hit numbers and effects.
    .filter((event) => event.actorId !== principalId)
    .map((event) => {
      const actorId = event.actorId;
      if (actorId === undefined) return event;
      const session = sessions.get(actorId);
      if (!session) return event;
      if (event.type !== 'player_attack' && event.type !== 'monster_attack') return event;
      const uid = actualPartyMonsterUid(session, event);
      return uid === undefined ? event : { ...event, uid: namespacedPartyUid(actorId, uid) };
    });
}

export function registerWebSocket(app: FastifyInstance, db: Database): void {
  const subscriptions = new Set<Subscription>();

  const stop = (subscription: Subscription): void => {
    clearInterval(subscription.timer);
    subscriptions.delete(subscription);
  };

  app.get('/ws', { websocket: true }, (socket) => {
    let subscription: Subscription | null = null;

    const send = (payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    const push = (): void => {
      if (!subscription) return;
      try {
        const { loaded, settlement } = loadCharacter(db, subscription.accountId, subscription.characterId);
        syncAccountEconomy(db, subscription.accountId, loaded);
        const character = economyCharacterView(db, subscription.accountId, loaded);
        const party = (character.caveParty ?? []) as PartyMemberView[];
        const partySessions = parseActivePartySessions(
          db,
          subscription.accountId,
          subscription.characterId,
          loaded.session?.huntId,
          party,
        );
        send({
          type: 'state',
          character: {
            ...character,
            partyMonsters: partyMonsterSnapshot(partySessions),
            partyEvents: remapPartyEvents(loaded.partyEvents ?? [], subscription.characterId, partySessions),
          },
          settlement: publicSettlement(settlement),
        });
      } catch (error) {
        send({ type: 'error', error: (error as Error).message });
        if (subscription) stop(subscription);
        subscription = null;
      }
    };

    socket.on('message', (raw: Buffer) => {
      let message: { type?: string; token?: string; characterId?: number };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        send({ type: 'error', error: 'Expected JSON.' });
        return;
      }

      if (message.type !== 'subscribe') {
        send({ type: 'error', error: 'Unknown message type.' });
        return;
      }

      const accountId = message.token ? db.accountIdForToken(message.token) : null;
      if (accountId === null) {
        send({ type: 'error', error: 'Invalid token.' });
        socket.close();
        return;
      }
      const characterId = Number(message.characterId);
      if (!Number.isInteger(characterId)) {
        send({ type: 'error', error: 'Missing characterId.' });
        return;
      }

      if (subscription) {
        markOffline(subscription.characterId);
        stop(subscription);
      }
      subscription = {
        socket,
        accountId,
        characterId,
        timer: setInterval(() => push(), PUSH_INTERVAL_MS),
      };
      subscriptions.add(subscription);
      markOnline(characterId);
      push();
    });

    socket.on('close', () => {
      if (subscription) {
        markOffline(subscription.characterId);
        stop(subscription);
      }
      subscription = null;
    });
  });

  app.addHook('onClose', async () => {
    for (const subscription of subscriptions) clearInterval(subscription.timer);
    subscriptions.clear();
  });
}
