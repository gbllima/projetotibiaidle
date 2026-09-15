import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { HuntSession, SimEvent } from '@tibia-idle/sim';
import type { Database } from './db.js';
import { loadCharacter, takeAwaySummary } from './game.js';
import { economyCharacterView, syncAccountEconomy } from './economy.js';
import { markOffline, markOnline } from './presence.js';
import { applyMultiplayerLiveHealing, decorateMultiplayerCharacter } from './social-live.js';

/**
 * Live session updates.
 *
 * The browser runs its own copy of the simulation for animation, so this socket
 * carries state snapshots rather than a blow-by-blow event stream. A snapshot
 * every couple of seconds is enough to correct any drift and costs a fraction
 * of the bandwidth, and because both sides run the same deterministic code from
 * the same seed there is normally nothing to correct.
 *
 * Multiplayer is the exception for presentation: one browser cannot predict the
 * other account's attacks. We therefore keep the most recent authoritative
 * combat batch produced by each connected member and relay it once to every
 * other party socket. The actual HP/MP/loot state still comes from the normal
 * server snapshots; these relayed events exist only so the shared viewport can
 * draw the other player's swings, missiles, spell effects and incoming hits.
 */

const PUSH_INTERVAL_MS = 2000;
const PARTY_UID_STRIDE = 10_000_000;
const PARTY_EVENT_TTL_MS = PUSH_INTERVAL_MS * 4;
const PARTY_EVENT_CAP = 48;

interface Subscription {
  socket: WebSocket;
  accountId: number;
  characterId: number;
  timer: NodeJS.Timeout;
  seenPartyEventVersions: Map<number, number>;
}

type PartyMemberView = {
  id: number;
  self?: boolean;
  active?: boolean;
  multiplayer?: boolean;
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

type PartyEventBatch = {
  version: number;
  huntId?: string;
  updatedAt: number;
  events: SimEvent[];
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
    if (!row || (!member.multiplayer && row.accountId !== accountId) || !row.session) continue;
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

function relayableOwnEvents(characterId: number, events: SimEvent[]): SimEvent[] {
  return events
    .filter((event) => event.type === 'player_attack' || event.type === 'monster_attack')
    .map((event) => ({ ...event, actorId: event.actorId ?? characterId }))
    .slice(-PARTY_EVENT_CAP);
}

function namespacedRelayedEvent(memberId: number, event: SimEvent): SimEvent {
  if ((event.type !== 'player_attack' && event.type !== 'monster_attack') || event.uid === undefined) return event;
  return { ...event, uid: namespacedPartyUid(memberId, event.uid) };
}

export function registerWebSocket(app: FastifyInstance, db: Database): void {
  const subscriptions = new Set<Subscription>();
  const partyEventBatches = new Map<number, PartyEventBatch>();
  let partyEventVersion = 0;

  const stop = (subscription: Subscription): void => {
    clearInterval(subscription.timer);
    subscriptions.delete(subscription);
  };

  const captureOwnCombatEvents = (
    characterId: number,
    huntId: string | undefined,
    events: SimEvent[],
  ): void => {
    const relay = relayableOwnEvents(characterId, events);
    if (relay.length === 0) return;
    partyEventBatches.set(characterId, {
      version: ++partyEventVersion,
      huntId,
      updatedAt: Date.now(),
      events: relay,
    });
  };

  const partyCombatEventsFor = (
    subscription: Subscription,
    huntId: string | undefined,
    sessions: Map<number, HuntSession>,
  ): SimEvent[] => {
    if (!huntId) return [];
    const now = Date.now();
    const output: SimEvent[] = [];

    for (const [memberId, session] of sessions) {
      const batch = partyEventBatches.get(memberId);
      if (!batch) continue;
      if (now - batch.updatedAt > PARTY_EVENT_TTL_MS) continue;
      if (batch.huntId !== huntId || session.huntId !== huntId) continue;
      const seen = subscription.seenPartyEventVersions.get(memberId) ?? 0;
      if (batch.version <= seen) continue;
      subscription.seenPartyEventVersions.set(memberId, batch.version);
      output.push(...batch.events.map((event) => namespacedRelayedEvent(memberId, event)));
    }

    return output.slice(-PARTY_EVENT_CAP);
  };

  app.get('/ws', { websocket: true }, (socket) => {
    let subscription: Subscription | null = null;

    const send = (payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    const push = (): void => {
      if (!subscription) return;
      try {
        const supportEvents = applyMultiplayerLiveHealing(db, subscription.characterId);
        const { loaded, settlement } = loadCharacter(db, subscription.accountId, subscription.characterId);
        syncAccountEconomy(db, subscription.accountId, loaded);
        const huntId = loaded.session?.huntId;
        captureOwnCombatEvents(subscription.characterId, huntId, settlement.events ?? []);

        const baseCharacter = economyCharacterView(db, subscription.accountId, loaded);
        const character = decorateMultiplayerCharacter(db, subscription.characterId, baseCharacter);
        const party = (character.caveParty ?? []) as PartyMemberView[];
        const sharedHuntId = huntId ?? character.partyActivity?.huntId;
        const partySessions = parseActivePartySessions(
          db,
          subscription.accountId,
          subscription.characterId,
          sharedHuntId,
          party,
        );
        const remoteCombatEvents = partyCombatEventsFor(subscription, sharedHuntId, partySessions);

        send({
          type: 'state',
          character: {
            ...character,
            partyMonsters: partyMonsterSnapshot(partySessions),
            partyEvents: [
              ...remapPartyEvents(loaded.partyEvents ?? [], subscription.characterId, partySessions),
              ...remoteCombatEvents,
              ...supportEvents,
            ].slice(-32),
          },
          settlement: takeAwaySummary(db, subscription.characterId, settlement),
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
        seenPartyEventVersions: new Map<number, number>(),
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
    partyEventBatches.clear();
  });
}