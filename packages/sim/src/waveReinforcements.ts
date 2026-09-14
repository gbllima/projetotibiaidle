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
import { isSpellGroupReady } from './spells.js';
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
 * Wave 10 remains the single skull creature per active party member.
 */
export const WAVE_ACTIVE_LIMIT = [3, 4, 5, 5, 6, 6, 6, 7, 7, 1] as const;

const NORMAL_WAVE_DELAY_MS = 3_000;
const BOSS_WAVE_DELAY_MS = 5_000;
const RAW_REFILL_BLOCK = Number.MAX_SAFE_INTEGER;
const CREDIT_EPSILON = 1e-9;

type ReinforcementSession = HuntSession & {
  /** Wave whose reinforcement state is currently tracked. */
  reinforcementWaveIndex?: number;
  /** Tick on which the next wave may put its first group on the floor. */
  reinforcementReadyTick?: number;
  /** Monsters hidden from the floor after upgrading an already-running hunt. */
  reinforcementQueue?: ActiveMonster[];
  /** Active party size/index supplied by the server party settlement loop. */
  reinforcementPartySize?: number;
  reinforcementPartyIndex?: number;
  /** Internal timer used by combat.ts. We block it while this module owns spawning. */
  nextWaveAtTick?: number;
};

export function waveActiveLimit(waveIndex: number): number {
  return WAVE_ACTIVE_LIMIT[Math.max(0, Math.min(WAVE_ACTIVE_LIMIT.length - 1, waveIndex))] ?? 6;
}

/**
 * A party shares the screen-wide cap instead of giving every member a full pack.
 * Example: a 4-player party on a 7-enemy wave gets 2/2/2/1 active enemies.
 * There is always at least one enemy per living party session so nobody becomes
 * an idle spectator merely because the party is larger than an early-wave cap.
 */
function sessionActiveLimit(session: ReinforcementSession, waveIndex: number): number {
  const globalLimit = waveActiveLimit(waveIndex);
  const partySize = Math.max(1, Math.trunc(session.reinforcementPartySize ?? 1));
  if (partySize <= 1 || isBossWave(waveIndex)) return globalLimit;
  const index = Math.max(0, Math.min(partySize - 1, Math.trunc(session.reinforcementPartyIndex ?? 0)));
  const sharedTotal = Math.max(globalLimit, partySize);
  const base = Math.floor(sharedTotal / partySize);
  const remainder = sharedTotal % partySize;
  return Math.max(1, base + (index < remainder ? 1 : 0));
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
  const limit = sessionActiveLimit(session, progress.waveIndex);
  if (session.active.length <= limit) return;
  const overflow = session.active.splice(limit);
  session.reinforcementQueue ??= [];
  session.reinforcementQueue.push(...overflow);
  layoutPackMonsters(session.active);
}

function beginWaveWait(session: ReinforcementSession, waveIndex: number): void {
  session.reinforcementWaveIndex = waveIndex;
  session.reinforcementQueue = [];
  session.reinforcementReadyTick = session.tick + delayTicks(waveIndex) - 1;
  // combat.ts still accrues the calibrated spawn budget, but this wrapper owns
  // every actual spawn so the raw full-pack refill can never bypass the cap.
  session.nextWaveAtTick = RAW_REFILL_BLOCK;
}

function ensureState(session: ReinforcementSession): void {
  if (isBossHunt(session.huntId)) return;
  const progress = waveProgress(session.totals.kills);
  if (session.reinforcementWaveIndex !== progress.waveIndex) {
    session.reinforcementWaveIndex = progress.waveIndex;
    session.reinforcementQueue = [];
    session.reinforcementReadyTick = undefined;

    // A persisted session (or a test fixture) may already sit exactly between
    // waves. Treat that state like a real transition instead of releasing a
    // fresh pack immediately.
    if (session.active.length === 0 && progress.killed === 0) {
      const legacyReady = session.nextWaveAtTick;
      session.reinforcementReadyTick = legacyReady !== undefined && legacyReady < RAW_REFILL_BLOCK
        ? legacyReady
        : session.tick + delayTicks(progress.waveIndex) - 1;
      session.nextWaveAtTick = RAW_REFILL_BLOCK;
    }
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
    session.nextWaveAtTick = RAW_REFILL_BLOCK;
  }
}

function remainingUnspawned(session: ReinforcementSession): number {
  const progress = waveProgress(session.totals.kills);
  const queued = session.reinforcementQueue?.length ?? 0;
  return Math.max(0, progress.size - progress.killed - session.active.length - queued);
}

function tauntEligible(session: ReinforcementSession): boolean {
  const character = session.character;
  if (!character.policy.taunt) return false;
  if (character.vocationId !== 4 && character.vocationId !== 8) return false;
  if (character.level < 20 || character.mana < 30) return false;
  if (!isSpellGroupReady(session.spellCooldowns ?? {}, 'support')) return false;
  // Queued monsters are already-real legacy creatures. Do not let exeta create
  // another copy while those are waiting to re-enter the floor.
  if ((session.reinforcementQueue?.length ?? 0) > 0) return false;
  return remainingUnspawned(session) > 0;
}

/**
 * Fill visible slots only from the hunt's calibrated spawn budget. The initial
 * room is still free, but every later creature consumes one whole spawn credit.
 * This keeps strong characters from turning low-level caves into unlimited XP.
 */
function fillOpenSlots(
  session: ReinforcementSession,
  events: SimEvent[],
  maxEvents: number,
): number {
  if (isBossHunt(session.huntId)) return 0;
  const progress = waveProgress(session.totals.kills);
  const limit = sessionActiveLimit(session, progress.waveIndex);
  if (session.active.length >= limit) return 0;

  let slots = limit - session.active.length;
  const queue = session.reinforcementQueue ?? (session.reinforcementQueue = []);
  let released = 0;

  // Sessions that were already running before this update may have real active
  // monsters parked in the hidden queue. Release those first without charging
  // the spawn budget a second time.
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
    released += 1;
  }

  let remaining = remainingUnspawned(session);
  if (slots <= 0 || remaining <= 0) {
    if (session.active.length > 0) layoutPackMonsters(session.active);
    return released;
  }

  const wholeCredits = Math.max(0, Math.floor(session.spawnCredits + CREDIT_EPSILON));
  const canReserveTaunt = tauntEligible(session)
    && wholeCredits >= (session.active.length > 0 ? 1 : 2)
    && remaining >= (session.active.length > 0 ? 1 : 2);
  const tauntReserve = canReserveTaunt ? 1 : 0;

  // Leave one visible slot and one spawn credit for exeta res when the helper is
  // ready. This makes taunt an intentional pull instead of letting automatic
  // reinforcements steal its vacancy a few microseconds earlier.
  const autoLimit = Math.max(session.active.length, limit - tauntReserve);
  slots = Math.max(0, autoLimit - session.active.length);
  const budget = Math.max(0, wholeCredits - tauntReserve);
  const toSpawn = Math.min(slots, remaining, budget);
  if (toSpawn <= 0) {
    if (session.active.length > 0) layoutPackMonsters(session.active);
    return released;
  }

  const pool = huntThroughput(session.huntId).monsters;
  if (pool.length === 0) return released;
  const rng = new Rng(0);
  rng.setState(session.rngState);

  let spawned = 0;
  while (spawned < toSpawn) {
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
    spawned += 1;
  }

  session.rngState = rng.getState();
  session.spawnCredits = Math.max(0, session.spawnCredits - spawned);
  session.initialPackCredit = 0;
  if (session.active.length > 0) layoutPackMonsters(session.active);
  return released + spawned;
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

    fillOpenSlots(session, events, maxEvents);
    if (session.active.length > 0) {
      session.reinforcementReadyTick = undefined;
      session.nextWaveAtTick = undefined;
    } else {
      // The 3s/5s transition is a minimum delay. If the cave has not earned a
      // spawn credit yet, remain ready and retry next tick instead of restarting
      // the delay or spawning for free.
      session.nextWaveAtTick = RAW_REFILL_BLOCK;
    }
    return;
  }

  // During a wave, a dead creature immediately frees a slot for a reinforcement,
  // but the replacement still needs one calibrated spawn credit.
  if (progress.killed > 0 || session.active.length > 0) {
    fillOpenSlots(session, events, maxEvents);
  }
}

/**
 * Same simulator as combat.ts, with two extra invariants:
 * - normal cave waves have a bounded number of simultaneous enemies;
 * - every post-entry creature consumes the calibrated hunt spawn budget.
 *
 * Total wave sizes, XP/loot rules and deterministic RNG stay unchanged.
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
    const limit = sessionActiveLimit(managed, before.waveIndex);
    const policy = managed.character.policy;
    const originalTaunt = policy.taunt;
    const allowTaunt = originalTaunt
      && managed.active.length > 0
      && managed.active.length < limit
      && managed.spawnCredits + CREDIT_EPSILON >= 1
      && tauntEligible(managed);

    // Raw combat knows how to cast exeta res but not about reinforcement caps or
    // spawn budgets. Temporarily disable taunt unless the wrapper reserved both.
    if (originalTaunt && !allowTaunt) policy.taunt = false;

    // combat.ts is still responsible for accruing spawnCredits every tick. Keep
    // its legacy full-pack refill blocked so only this wrapper may spend them.
    managed.nextWaveAtTick = RAW_REFILL_BLOCK;

    const remainingEventBudget = Math.max(0, maxEvents - events.length);
    const produced = advanceRaw(managed, 1, {
      ...options,
      maxEvents: remainingEventBudget,
    });

    policy.taunt = originalTaunt;
    const exetaCast = produced.some((event) => event.type === 'buff' && event.words === 'exeta res');
    if (exetaCast) {
      managed.spawnCredits = Math.max(0, managed.spawnCredits - 1);
    }
    for (const event of produced) pushEvent(events, event, maxEvents);

    const after = waveProgress(managed.totals.kills);
    if (after.waveIndex !== before.waveIndex) {
      beginWaveWait(managed, after.waveIndex);
      continue;
    }

    if (managed.reinforcementReadyTick === undefined) {
      fillOpenSlots(managed, events, maxEvents);
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
