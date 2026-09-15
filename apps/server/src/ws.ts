import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { advance, type HuntSession, type SimEvent } from '@tibia-idle/sim';
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
 * other account's attacks. A normal server settlement intentionally does not
 * retain visual events, so relying on settlement.events makes a remote player
 * look frozen while their monsters still lose HP. Instead, each subscriber keeps
 * the previous authoritative party-session snapshot and deterministically replays
 * only the ticks that happened since that snapshot. Those replayed events are
 * presentation-only; HP/MP/loot remain authoritative server state.
 */

const PUSH_INTERVAL_MS = 2000;
const PARTY_UID_STRIDE = 10_000_000;
const PARTY_EVENT_CAP = 64;
const MAX_REPLAY_TICKS = 240;

interface Subscription {
  socket: WebSocket;
  accountId: number;
  characterId: number;
  timer: NodeJS.Timeout;
  partySessionSnapshots: Map<number, HuntSession>;
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
    // The principal's events already arrive in the normal prediction stream.
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

function replayRemotePartyEvents(
  subscription: Subscription,
  huntId: string | undefined,
  sessions: Map<number, HuntSession>,
): SimEvent[] {
  const output: SimEvent[] = [];
  const activeMembers = new Set(sessions.keys());

  for (const memberId of [...subscription.partySessionSnapshots.keys()]) {
    if (!activeMembers.has(memberId)) subscription.partySessionSnapshots.delete(memberId);
  }

  if (!huntId) return output;

  for (const [memberId, current] of sessions) {
    const previous = subscription.partySessionSnapshots.get(memberId);
    subscription.partySessionSnapshots.set(memberId, structuredClone(current));

    if (!previous || previous.huntId !== huntId || current.huntId !== huntId) continue;
    if (previous.status !== 'active' || current.status !== 'active') continue;

    const previousTick = Number(previous.tick ?? 0);
    const currentTick = Number(current.tick ?? 0);
    const elapsedTicks = currentTick - previousTick;
    if (elapsedTicks <= 0 || elapsedTicks > MAX_REPLAY_TICKS) continue;

    try {
      const replay = structuredClone(previous);
      const produced = advance(replay, elapsedTicks, { maxEvents: PARTY_EVENT_CAP });
      for (const event of produced) {
        if (event.type !== 'player_attack' && event.type !== 'monster_attack') continue;
        const actorEvent = { ...event, actorId: event.actorId ?? memberId };
        if (actorEvent.uid === undefined) {
          output.push(actorEvent);
          continue;
        }
        output.push({ ...actorEvent, uid: namespacedPartyUid(memberId, actorEvent.uid) });
      }
    } catch (error) {
      console.error('party event replay', memberId, error);
    }
  }

  return output.slice(-PARTY_EVENT_CAP);
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
        const supportEvents = applyMultiplayerLiveHealing(db, subscription.characterId);
        const { loaded, settlement } = loadCharacter(db, subscription.accountId, subscription.characterId);
        syncAccountEconomy(db, subscription.accountId, loaded);

        const baseCharacter = economyCharacterView(db, subscription.accountId, loaded);
        const character = decorateMultiplayerCharacter(db, subscription.characterId, baseCharacter);
        const party = (character.caveParty ?? []) as PartyMemberView[];
        const sharedHuntId = loaded.session?.huntId ?? character.partyActivity?.huntId;
        const partySessions = parseActivePartySessions(
          db,
          subscription.accountId,
          subscription.characterId,
          sharedHuntId,
          party,
        );
        const remoteCombatEvents = replayRemotePartyEvents(subscription, sharedHuntId, partySessions);

        send({
          type: 'state',
          character: {
            ...character,
            partyMonsters: partyMonsterSnapshot(partySessions),
            partyEvents: [
              ...remapPartyEvents(loaded.partyEvents ?? [], subscription.characterId, partySessions),
              ...remoteCombatEvents,
              ...supportEvents,
            ].slice(-PARTY_EVENT_CAP),
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
        partySessionSnapshots: new Map<number, HuntSession>(),
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