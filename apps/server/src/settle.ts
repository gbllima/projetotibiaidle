import { getHunt, recommendedLevelFor } from '@tibia-idle/data';
import {
  advance, DEFAULT_RATES, defaultSupplies, deriveStats, describeSession, dailyBoostedMonster,
  ensureHuntTask, isBossHunt, isVip, movePouchToWarehouse, packHuntSupplies, parseBossHuntId,
  bossOnCooldown, getBossEncounterForHunt, recordBossKill, pouchSellValue, startSession, suppliesCost, TICK_MS,
  type CharacterState, type HuntSession, type SimEvent,
} from '@tibia-idle/sim';

/**
 * Turning elapsed wall-clock time into simulated progress.
 *
 * The server is the authority: it runs the same deterministic simulation the
 * browser does and stores the result. A client that lies about how long it was
 * away gains nothing, because the elapsed time comes from the server clock and
 * the seed lives in the stored session.
 *
 * Offline catch-up is the same tick loop as a live session, with two knobs:
 * a shorter cap for free accounts, and ~70% XP/loot so watching still pays.
 */

/** Hardest cap on catch-up. Free accounts get less; VIP matches the design doc. */
export const FREE_OFFLINE_HOURS = 8;
export const VIP_OFFLINE_HOURS = 24;
export const MAX_OFFLINE_HOURS = VIP_OFFLINE_HOURS;
/** Gaps longer than this are treated as offline catch-up, not a live tick. */
export const OFFLINE_GAP_MS = 90_000;
/** Offline XP/loot vs watching the hunt. */
export const OFFLINE_EFFICIENCY = 0.7;
/** One stamina minute every three real minutes while not hunting. */
export const STAMINA_REGEN_MS = 3 * 60 * 1000;

/** Shortest trip worth starting when gold is tight. Partial packs are allowed. */
const MIN_SUPPLY_HOURS = 0.2;
/** Default trip length when the client does not specify hours. */
export const DEFAULT_HUNT_HOURS = 1;
/** Boss lever fights: one creature, minimal supplies. */
export const BOSS_TRIP_HOURS = 0.25;

export interface SettlementDelta {
  experience: number;
  kills: number;
  lootValue: number;
  supplyValue: number;
  levels: number;
}

export interface SettlementResult {
  session: HuntSession | null;
  events: SimEvent[];
  /** Simulated seconds actually applied. */
  elapsedSeconds: number;
  /** Seconds discarded because they exceeded the offline cap. */
  discardedSeconds: number;
  stoppedBecause: string | null;
  offline: boolean;
  efficiency: number;
  capHours: number;
  delta: SettlementDelta;
  deathPenalty?: import('@tibia-idle/sim').DeathPenaltyResult | null;
}

export function offlineCapHours(character: CharacterState, now = Date.now()): number {
  return isVip(character, now) ? VIP_OFFLINE_HOURS : FREE_OFFLINE_HOURS;
}

export function requiredPartySlots(partySizes: readonly string[]): number {
  if (partySizes.includes('solo') || partySizes.length === 0) return 1;
  if (partySizes.includes('duo')) return 2;
  return 3;
}

export function publicSettlement(settlement: SettlementResult) {
  return {
    elapsedSeconds: settlement.elapsedSeconds,
    discardedSeconds: settlement.discardedSeconds,
    stoppedBecause: settlement.stoppedBecause,
    offline: settlement.offline,
    efficiency: settlement.efficiency,
    capHours: settlement.capHours,
    delta: settlement.delta,
    deathPenalty: settlement.deathPenalty ?? null,
  };
}

export function regenStamina(character: CharacterState, idleMs: number): number {
  const gained = Math.floor(Math.max(0, idleMs) / STAMINA_REGEN_MS);
  if (gained <= 0) return 0;
  const before = character.stamina;
  character.stamina = Math.min(2520, character.stamina + gained);
  return character.stamina - before;
}

const emptyDelta = (): SettlementDelta => ({
  experience: 0, kills: 0, lootValue: 0, supplyValue: 0, levels: 0,
});

export function settle(
  session: HuntSession | null,
  settledAtMs: number,
  nowMs: number,
  options: { maxEvents?: number } = {},
): SettlementResult {
  const elapsedMs = Math.max(0, nowMs - settledAtMs);
  const empty = {
    session,
    events: [] as SimEvent[],
    elapsedSeconds: 0,
    discardedSeconds: 0,
    stoppedBecause: session && session.status !== 'active' ? session.status : null,
    offline: false,
    efficiency: 1,
    capHours: MAX_OFFLINE_HOURS,
    delta: emptyDelta(),
    deathPenalty: session?.lastDeathPenalty ?? null,
  };

  if (!session || session.status !== 'active') {
    return empty;
  }

  const offline = elapsedMs > OFFLINE_GAP_MS;
  const capHours = offlineCapHours(session.character, nowMs);
  const capMs = capHours * 60 * 60 * 1000;
  const appliedMs = Math.min(elapsedMs, capMs);
  const ticks = Math.floor(appliedMs / TICK_MS);
  if (ticks <= 0) {
    return { ...empty, capHours, offline };
  }

  const before = {
    experience: session.totals.experience,
    kills: session.totals.kills,
    lootValue: session.totals.lootValue,
    supplyValue: session.totals.supplyValue,
    level: session.character.level,
  };
  const efficiency = offline ? OFFLINE_EFFICIENCY : 1;
  const events = advance(session, ticks, {
    maxEvents: options.maxEvents ?? 0,
    rates: {
      ...DEFAULT_RATES,
      experience: DEFAULT_RATES.experience * efficiency,
      loot: DEFAULT_RATES.loot * efficiency,
    },
  });

  return {
    session,
    events,
    elapsedSeconds: Math.round((ticks * TICK_MS) / 1000),
    discardedSeconds: Math.round((elapsedMs - appliedMs) / 1000),
    stoppedBecause: session.status === 'active' ? null : session.status,
    offline,
    efficiency,
    capHours,
    delta: {
      experience: session.totals.experience - before.experience,
      kills: session.totals.kills - before.kills,
      lootValue: session.totals.lootValue - before.lootValue,
      supplyValue: session.totals.supplyValue - before.supplyValue,
      levels: session.character.level - before.level,
    },
    deathPenalty: session.lastDeathPenalty ?? null,
  };
}

export class GameError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'GameError';
  }
}

/**
 * Begin a hunt.
 *
 * Zones below the character's level are allowed - a player may want a safe,
 * profitable grind - but zones they cannot survive are refused rather than
 * silently letting them die while offline.
 */
export function beginHunt(
  character: CharacterState,
  huntId: string,
  seed: bigint,
  options: { restock?: boolean; hours?: number } = {},
): HuntSession {
  if (isBossHunt(huntId)) {
    const encounter = getBossEncounterForHunt(huntId);
    if (!encounter) throw new GameError('Unknown boss.', 404);
    if (bossOnCooldown(character, encounter.id)) {
      throw new GameError('This boss is on cooldown. You can fight again 20 hours after a kill.', 422);
    }
    if (character.level < Math.floor(encounter.minLevel / 2)) {
      throw new GameError(`This boss needs about level ${encounter.minLevel}. You are level ${character.level}.`, 422);
    }

    if (options.restock !== false) {
      const { supplies, cost } = packHuntSupplies(character, BOSS_TRIP_HOURS);
      if (supplies.length === 0 || cost > character.gold) {
        const hourly = suppliesCost(defaultSupplies(character, 1));
        throw new GameError(
          hourly > 0
            ? `You cannot afford enough supplies for this boss. Around ${Math.ceil(hourly * MIN_SUPPLY_HOURS).toLocaleString()} gold buys a short trip.`
            : 'You cannot afford enough supplies for this boss.',
          402,
        );
      }
      character.gold -= cost;
      character.supplies = supplies;
    }

    character.lastHuntId = huntId;
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = stats.maxMana;

    const session = startSession(character, huntId, seed);
    session.boostedMonsterId = dailyBoostedMonster()?.id;
    session.startedAt = Date.now();
    return session;
  }

  const required = recommendedLevelFor(huntId, character.vocationId);
  if (required === null) {
    throw new GameError('No vocation can sustain that hunt yet.', 422);
  }
  // Half the recommended level is the point where a character stops being able
  // to hold their own; below it a session is just a scheduled death.
  if (character.level < Math.floor(required / 2)) {
    throw new GameError(`That hunt needs about level ${required}. You are level ${character.level}.`, 422);
  }
  const partyNeed = requiredPartySlots(getHunt(huntId).partySizes);
  if ((character.partySlots ?? 1) < partyNeed) {
    throw new GameError(`That hunt needs a party of ${partyNeed}. Unlock more party slots first.`, 422);
  }

  if (options.restock !== false) {
    const tripHours = options.hours ?? DEFAULT_HUNT_HOURS;
    const { supplies, cost } = packHuntSupplies(character, tripHours);
    if (supplies.length === 0 || cost > character.gold) {
      const hourly = suppliesCost(defaultSupplies(character, 1));
      throw new GameError(
        hourly > 0
          ? `You cannot afford enough supplies for this hunt. Around ${Math.ceil(hourly * MIN_SUPPLY_HOURS).toLocaleString()} gold buys a short trip.`
          : 'You cannot afford enough supplies for this hunt.',
        402,
      );
    }
    character.gold -= cost;
    character.supplies = supplies;
  }

  character.lastHuntId = huntId;
  ensureHuntTask(character, huntId);

  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;

  const session = startSession(character, huntId, seed);
  session.boostedMonsterId = dailyBoostedMonster()?.id;
  session.startedAt = Date.now();
  return session;
}

/**
 * Bank the gold a session earned and detach it from the character.
 *
 * Unused potions go back to the shop at what they cost, so packing for a long
 * trip and returning early is a matter of liquidity rather than a penalty.
 */
export function endHunt(session: HuntSession): {
  gold: number;
  refund: number;
  character: CharacterState;
} {
  const character = session.character;
  const stash = Boolean(character.policy.lootToWarehouse);
  const pouch = stash ? 0 : pouchSellValue(session);
  const refund = suppliesCost(character.supplies);
  if (stash) movePouchToWarehouse(session);
  else session.totals.lootByItem = {};
  character.gold += pouch + refund;
  character.supplies = [];
  if (session.status === 'boss_cleared') {
    const encounterId = parseBossHuntId(session.huntId);
    if (encounterId) recordBossKill(character, encounterId, Date.now());
  }
  if (session.status === 'died') {
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = stats.maxMana;
  }
  return { gold: pouch, refund, character };
}

export const summarise = describeSession;
