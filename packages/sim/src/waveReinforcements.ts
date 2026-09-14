import type { Monster } from '@tibia-idle/data';
import { layoutPackMonsters } from './ammo.js';
import {
  advance as advanceRaw,
  startSession as startSessionRaw,
  type AdvanceOptions,
} from './combat.js';
import { huntThroughput } from './throughput.js';
import { Rng } from './rng.js';
import { isBossHunt } from './bossEncounters.js';
import { meleeSurroundSpots, PLAYER_TILE } from './areas.js';
import {
  BOSS_HEALTH_MULT,
  isBossWave,
  waveProgress,
} from './waves.js';
import {
  TICK_MS,
  type ActiveMonster,
  type CharacterState,
  type HuntSession,
  type SimEvent,
} from './types.js';

/**
 * Total monsters in a wave still grows normally, but only this many may be
 * engaged at once. The rest enter as reinforcements whenever a slot opens.
 * Wave 10 remains the single skull creature.
 */
export const WAVE_ACTIVE_LIMIT = [3, 4, 5, 5, 6, 6, 6, 7, 7, 1] as const;

const NORMAL_WAVE_DELAY_MS = 3_000;
const BOSS_WAVE_DELAY_MS = 5_000;
const RAW_REFILL_BLOCK = Number.MAX_SAFE_INTEGER;

type ReinforcementSession = HuntSession & {
  /** Wave whose reinforcement state is currently tracked. */
  reinforcementWaveIndex?: number;
  /** Tick on which the next wave may put its first group on the floor. */
  reinforcementReadyTick?: number;
  /** Monsters hidden from the floor after upgrading an already-running hunt. */
  reinforcementQueue?: ActiveMonster[];
  /** Internal timer used by combat.ts. We block it while this module owns spawning. */
  nextWaveAtTick?: number;
};

export function waveActiveLimit(waveIndex: number): number {
  return WAVE_ACTIVE_LIMIT[Math.max(0, Math.min(WAVE_ACTIVE_LIMIT.length - 1, waveIndex))] ?? 6;
}

function delayTicks(waveIndex: number): number {
  const delay = isBossWave(waveIndex) ? BOSS_WAVE_DELAY_MS : NORMAL_WAVE_DELAY_MS;
  return Math.max(1, Math.round(delay / TICK_MS));
}

function pickMonster(session: HuntSession, pool: Monster[], rng: Rng): Monster | undefined {
  if (pool.length === 0) return undefined;
  const progress = waveProgress(session.totals.kills);
  if (!isBossWave(progress.waveIndex)) return rng.pick(pool);
  const regular = pool.filter((monster) => !monster.isBoss);
  const cave = regular.length > 0 ? regular : pool;
  return cave.reduce((best, monster) => (monster.health > best.health ? monster : best));
}

function makeMonster(session: HuntSession, monster: Monster): ActiveMonster {
  const progress = waveProgress(session.totals.kills);
  const health = isBossWave(progress.waveIndex)
    ? Math.max(1, Math.round(monster.health * BOSS_HEALTH_MULT))
    : monster.health;
  const [spawnTile] = meleeSurroundSpots(PLAYER_TILE.x, PLAYER_TILE.y);
  return {
    uid: session.nextUid++,
    monsterId: monster.id,
    health,
    maxHealth: health,
    tileX: spawnTile?.x ?? PLAYER_TILE.x,
    tileY: spawnTile?.y ?? PLAYER_TILE.y + 2,
    attackCooldowns: monster.attacks.map(() => 0),
    healCooldown: 0,
  };
}

function pushEvent(events: SimEvent[], event: SimEvent, maxEvents: number): void {
  if (events.length < maxEvents) events.push(event);
}

function trimLegacyOverflow(session: ReinforcementSession): void {
  if (isBossHunt(session.huntId)) return;
  const progress = waveProgress(session.totals.kills);
  const limit = waveActiveLimit(progress.waveIndex);
  if (session.active.length <= limit) return;
  const overflow = session.active.splice(limit);
  session.reinforcementQueue ??= [];
  session.reinforcementQueue.push(...overflow);
  layoutPackMonsters(session.active);
}

function ensureState(session: ReinforcementSession): void {
  if (isBossHunt(session.huntId)) return;
  const progress = waveProgress(session.totals.kills);
  if (session.reinforcementWaveIndex !== progress.waveIndex) {
    session.reinforcementWaveIndex = progress.waveIndex;
    session.reinforcementReadyTick = undefined;
    // A wave cannot legitimately change while old queued creatures still live.
    // Clear only stale data left by an older client/server version.
    session.reinforcementQueue = [];
  }
  session.reinforcementQueue ??= [];
  trimLegacyOverflow(session);

  // Existing persisted sessions can already be between waves when this feature
  // is deployed. Preserve the old timer instead of spawning immediately.
  if (
    session.active.length === 0
    && progress.killed === 0
    && session.reinforcementReadyTick === undefined
    && session.tick > 0
  ) {
    const legacyReady = session.nextWaveAtTick;
    session.reinforcementReadyTick = legacyReady !== undefined && legacyReady < RAW_REFILL_BLOCK
      ? legacyReady
      : session.tick + delayTicks(progress.waveIndex) - 1;
  }
}

function remainingUnspawned(session: ReinforcementSession): number {
  const progress = waveProgress(session.totals.kills);
  const queued = session.reinforcementQueue?.length ?? 0;
  return Math.max(0, progress.size - progress.killed - session.active.length - queued);
}

function fillOpenSlots(
  session: ReinforcementSession,
  events: SimEvent[],
  maxEvents: number,
): void {
  if (isBossHunt(session.huntId)) return;
  const progress = waveProgress(session.totals.kills);
  const limit = waveActiveLimit(progress.waveIndex);
  if (session.active.length >= limit) return;

  let slots = limit - session.active.length;
  const queue = session.reinforcementQueue ?? (session.reinforcementQueue = []);

  // Sessions that were already running before this update may have real active
  // monsters parked in the hidden queue. Release those first without rerolling.
  while (slots > 0 && queue.length > 0) {
    const monster = queue.shift();
    if (!monster) break;
    session.active.push(monster);
    pushEvent(events, {
      tick: session.tick,
      type: 'monster_spawn',
      uid: monster.uid,
      monsterId: monster.monsterId,
    }, maxEvents);
    slots -= 1;
  }

  let remaining = remainingUnspawned(session);
  if (slots <= 0 || remaining <= 0) {
    if (session.active.length > 0) layoutPackMonsters(session.active);
    return;
  }

  const pool = huntThroughput(session.huntId).monsters;
  if (pool.length === 0) return;
  const rng = new Rng(0);
  rng.setState(session.rngState);

  while (slots > 0 && remaining > 0) {
    const definition = pickMonster(session, pool, rng);
    if (!definition) break;
    const monster = makeMonster(session, definition);
    session.active.push(monster);
    pushEvent(events, {
      tick: session.tick,
      type: 'monster_spawn',
      uid: monster.uid,
      monsterId: definition.id,
    }, maxEvents);
    slots -= 1;
    remaining -= 1;
  }

  session.rngState = rng.getState();
  session.spawnCredits = Math.max(0, session.spawnCredits - Math.min(session.spawnCredits, limit));
  session.initialPackCredit = 0;
  if (session.active.length > 0) layoutPackMonsters(session.active);
}

function beginWaveWait(session: ReinforcementSession, waveIndex: number): void {
  session.reinforcementWaveIndex = waveIndex;
  session.reinforcementQueue = [];
  session.reinforcementReadyTick = session.tick + delayTicks(waveIndex) - 1;
  // Prevent combat.ts from releasing its complete 5/7/9/14-monster pack while
  // this wrapper is counting down to the capped first group.
  session.nextWaveAtTick = RAW_REFILL_BLOCK;
}

function prepareBeforeTick(
  session: ReinforcementSession,
  events: SimEvent[],
  maxEvents: number,
): void {
  if (isBossHunt(session.huntId)) return;
  ensureState(session);
  const progress = waveProgress(session.totals.kills);

  if (session.reinforcementReadyTick !== undefined) {
    if (session.tick + 1 < session.reinforcementReadyTick) {
      session.nextWaveAtTick = RAW_REFILL_BLOCK;
      return;
    }
    session.reinforcementReadyTick = undefined;
    session.nextWaveAtTick = undefined;
    fillOpenSlots(session, events, maxEvents);
    return;
  }

  // During a wave, a dead creature immediately frees a slot for the next one.
  if (progress.killed > 0 || session.active.length > 0) {
    fillOpenSlots(session, events, maxEvents);
    if (session.active.length > 0) session.nextWaveAtTick = undefined;
  }
}

/**
 * Same simulator as combat.ts, with one extra invariant: normal cave waves have
 * a bounded number of simultaneous enemies. Total kills, XP and loot for each
 * wave are unchanged; only their release cadence changes.
 */
export function advance(session: HuntSession, ticks: number, options: AdvanceOptions = {}): SimEvent[] {
  if (ticks <= 0 || isBossHunt(session.huntId)) return advanceRaw(session, ticks, options);

  const managed = session as ReinforcementSession;
  const maxEvents = options.maxEvents ?? 5000;
  const events: SimEvent[] = [];
  ensureState(managed);

  for (let step = 0; step < ticks && managed.status === 'active'; step += 1) {
    prepareBeforeTick(managed, events, maxEvents);

    const before = waveProgress(managed.totals.kills);
    const limit = waveActiveLimit(before.waveIndex);
    const policy = managed.character.policy;
    const originalTaunt = policy.taunt;
    // Exeta res may fill an open slot, but it must never break the visual cap.
    if (managed.active.length >= limit && originalTaunt) policy.taunt = false;

    if (managed.reinforcementReadyTick !== undefined && managed.active.length === 0) {
      managed.nextWaveAtTick = RAW_REFILL_BLOCK;
    }

    const remainingEventBudget = Math.max(0, maxEvents - events.length);
    const produced = advanceRaw(managed, 1, {
      ...options,
      maxEvents: remainingEventBudget,
    });

    policy.taunt = originalTaunt;
    for (const event of produced) pushEvent(events, event, maxEvents);

    const after = waveProgress(managed.totals.kills);
    if (after.waveIndex !== before.waveIndex) {
      beginWaveWait(managed, after.waveIndex);
      continue;
    }

    // If the visible group was wiped but this wave still has enemies left,
    // cancel combat.ts's full-pack timer and release replacements immediately.
    if (managed.reinforcementReadyTick === undefined) {
      fillOpenSlots(managed, events, maxEvents);
      if (managed.active.length > 0) managed.nextWaveAtTick = undefined;
    }

    trimLegacyOverflow(managed);
  }

  return events;
}

export function startSession(
  character: CharacterState,
  huntId: string,
  seed: number | bigint,
): HuntSession {
  const session = startSessionRaw(character, huntId, seed) as ReinforcementSession;
  if (!isBossHunt(huntId)) {
    session.reinforcementWaveIndex = waveProgress(session.totals.kills).waveIndex;
    session.reinforcementQueue = [];
    session.reinforcementReadyTick = undefined;
    trimLegacyOverflow(session);
  }
  return session;
}
