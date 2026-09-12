import { getHunt, recommendedLevelFor } from '@tibia-idle/data';
import {
  advance, DEFAULT_RATES, defaultSupplies, deriveStats, describeSession, dailyBoostedMonster,
  ensureHuntTask, isBossHunt, isVip, movePouchToWarehouse, packHuntSupplies, parseBossHuntId,
  bossOnCooldown, getBossEncounterForHunt, recordBossKill, pouchSellValue, startSession, suppliesCost, TICK_MS,
  type CharacterState, type HuntSession, type SimEvent, type AdvanceOptions,
} from '@tibia-idle/sim';

/** Hardest cap on catch-up. Free accounts get less; VIP matches the design doc. */
export const FREE_OFFLINE_HOURS = 8;
export const VIP_OFFLINE_HOURS = 24;
export const MAX_OFFLINE_HOURS = VIP_OFFLINE_HOURS;
/** Gaps longer than this are treated as offline catch-up, not a live tick. */
export const OFFLINE_GAP_MS = 90_000;
/** Offline XP/loot vs watching the hunt. */
export const OFFLINE_EFFICIENCY = 0.7;

/** Tibia stamina rules: first 10 minutes logged out do not regenerate stamina. */
export const STAMINA_REGEN_DELAY_MS = 10 * 60 * 1000;
/** Up to 39h: 3 minutes logged out restore 1 stamina minute. */
export const STAMINA_REGEN_NORMAL_MS = 3 * 60 * 1000;
/** From 39h to 42h: 6 minutes logged out restore 1 stamina minute. */
export const STAMINA_REGEN_GREEN_MS = 6 * 60 * 1000;
export const STAMINA_GREEN_START = 39 * 60;
export const STAMINA_MAX = 42 * 60;

const MIN_SUPPLY_HOURS = 0.2;
export const DEFAULT_HUNT_HOURS = 1;
export const BOSS_TRIP_HOURS = 0.25;

export interface SettlementDelta { experience: number; kills: number; lootValue: number; supplyValue: number; levels: number; }
export interface SettlementResult {
  session: HuntSession | null; events: SimEvent[]; elapsedSeconds: number; discardedSeconds: number;
  stoppedBecause: string | null; offline: boolean; efficiency: number; capHours: number; delta: SettlementDelta;
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
  return { elapsedSeconds: settlement.elapsedSeconds, discardedSeconds: settlement.discardedSeconds, stoppedBecause: settlement.stoppedBecause, offline: settlement.offline, efficiency: settlement.efficiency, capHours: settlement.capHours, delta: settlement.delta, deathPenalty: settlement.deathPenalty ?? null };
}

/**
 * Restore stamina exactly like Tibia's logged-out regeneration.
 * `idleMs` is the complete continuous logged-out/resting period. The first
 * ten minutes never count. Remaining time is consumed across the 39h boundary:
 * 3:1 below 39h and 6:1 for the green 39-42h band.
 */
export function regenStamina(character: CharacterState, idleMs: number): number {
  if (idleMs <= 0) return 0;
  const previousRest = character.staminaRestMs ?? 0;
  const rest = previousRest + idleMs;
  character.staminaRestMs = Math.min(STAMINA_REGEN_DELAY_MS, rest);
  let availableMs = (character.staminaRegenCreditMs ?? 0)
    + Math.max(0, rest - STAMINA_REGEN_DELAY_MS) - Math.max(0, previousRest - STAMINA_REGEN_DELAY_MS);
  const before = character.stamina;

  if (character.stamina < STAMINA_GREEN_START && availableMs >= STAMINA_REGEN_NORMAL_MS) {
    const missingNormal = STAMINA_GREEN_START - character.stamina;
    const normalGain = Math.min(missingNormal, Math.floor(availableMs / STAMINA_REGEN_NORMAL_MS));
    character.stamina += normalGain;
    availableMs -= normalGain * STAMINA_REGEN_NORMAL_MS;
  }

  if (character.stamina >= STAMINA_GREEN_START && character.stamina < STAMINA_MAX && availableMs >= STAMINA_REGEN_GREEN_MS) {
    const missingGreen = STAMINA_MAX - character.stamina;
    const greenGain = Math.min(missingGreen, Math.floor(availableMs / STAMINA_REGEN_GREEN_MS));
    character.stamina += greenGain;
    availableMs -= greenGain * STAMINA_REGEN_GREEN_MS;
  }

  character.stamina = Math.min(STAMINA_MAX, character.stamina);
  character.staminaRegenCreditMs = character.stamina >= STAMINA_MAX ? 0 : availableMs;
  return character.stamina - before;
}

const emptyDelta = (): SettlementDelta => ({ experience: 0, kills: 0, lootValue: 0, supplyValue: 0, levels: 0 });
export function settle(session: HuntSession | null, settledAtMs: number, nowMs: number, options: { maxEvents?: number; offline?: boolean; awardKillExperience?: AdvanceOptions['awardKillExperience'] } = {}): SettlementResult {
  const elapsedMs = Math.max(0, nowMs - settledAtMs);
  const empty = { session, events: [] as SimEvent[], elapsedSeconds: 0, discardedSeconds: 0, stoppedBecause: session && session.status !== 'active' ? session.status : null, offline: false, efficiency: 1, capHours: MAX_OFFLINE_HOURS, delta: emptyDelta(), deathPenalty: session?.lastDeathPenalty ?? null };
  if (!session || session.status !== 'active') return empty;
  const offline = options.offline ?? elapsedMs > OFFLINE_GAP_MS;
  const capHours = offlineCapHours(session.character, nowMs);
  const capMs = capHours * 60 * 60 * 1000;
  const appliedMs = Math.min(elapsedMs, capMs);
  const ticks = Math.floor(appliedMs / TICK_MS);
  if (ticks <= 0) return { ...empty, capHours, offline };
  const before = { experience: session.totals.experience, kills: session.totals.kills, lootValue: session.totals.lootValue, supplyValue: session.totals.supplyValue, level: session.character.level };
  const efficiency = offline ? OFFLINE_EFFICIENCY : 1;
  const events = advance(session, ticks, { maxEvents: options.maxEvents ?? 0, awardKillExperience: options.awardKillExperience, rates: { ...DEFAULT_RATES, experience: DEFAULT_RATES.experience * efficiency, loot: DEFAULT_RATES.loot * efficiency } });
  return { session, events, elapsedSeconds: Math.round((ticks * TICK_MS) / 1000), discardedSeconds: Math.round((elapsedMs - appliedMs) / 1000), stoppedBecause: session.status === 'active' ? null : session.status, offline, efficiency, capHours, delta: { experience: session.totals.experience - before.experience, kills: session.totals.kills - before.kills, lootValue: session.totals.lootValue - before.lootValue, supplyValue: session.totals.supplyValue - before.supplyValue, levels: session.character.level - before.level }, deathPenalty: session.lastDeathPenalty ?? null };
}

export class GameError extends Error { constructor(message: string, readonly status = 400) { super(message); this.name = 'GameError'; } }
export function beginHunt(character: CharacterState, huntId: string, seed: bigint, options: { restock?: boolean; hours?: number; principal?: CharacterState } = {}): HuntSession {
  const principal = options.principal ?? character;
  if (isBossHunt(huntId)) {
    const encounter = getBossEncounterForHunt(huntId);
    if (!encounter) throw new GameError('Unknown boss.', 404);
    if (bossOnCooldown(character, encounter.id)) throw new GameError('This boss is on cooldown. You can fight again 20 hours after a kill.', 422);
    if (principal.level < encounter.minLevel) throw new GameError(`This boss needs about level ${encounter.minLevel}. You are level ${principal.level}.`, 422);
    if (options.restock !== false) {
      const { supplies, cost } = packHuntSupplies(character, BOSS_TRIP_HOURS);
      if (supplies.length === 0 || cost > character.gold) { const hourly = suppliesCost(defaultSupplies(character, 1)); throw new GameError(hourly > 0 ? `You cannot afford enough supplies for this boss. Around ${Math.ceil(hourly * MIN_SUPPLY_HOURS).toLocaleString()} gold buys a short trip.` : 'You cannot afford enough supplies for this boss.', 402); }
      character.gold -= cost; character.supplies = supplies;
    }
    character.lastHuntId = huntId; const stats = deriveStats(character); character.health = stats.maxHealth; character.mana = stats.maxMana;
    character.staminaRestMs = 0; character.staminaRegenCreditMs = 0;
    const session = startSession(character, huntId, seed); session.boostedMonsterId = dailyBoostedMonster()?.id; session.startedAt = Date.now(); return session;
  }
  const required = recommendedLevelFor(huntId, principal.vocationId);
  if (required === null) throw new GameError('No vocation can sustain that hunt yet.', 422);
  if (principal.level < required) throw new GameError(`Conteúdo bloqueado: o personagem principal precisa ser nível ${required} ou maior.`, 422);
  const partyNeed = requiredPartySlots(getHunt(huntId).partySizes);
  if ((principal.partySlots ?? 1) < partyNeed) throw new GameError(`That hunt needs a party of ${partyNeed}. Unlock more party slots first.`, 422);
  if (options.restock !== false) {
    const tripHours = options.hours ?? DEFAULT_HUNT_HOURS; const { supplies, cost } = packHuntSupplies(character, tripHours);
    if (supplies.length === 0 || cost > character.gold) { const hourly = suppliesCost(defaultSupplies(character, 1)); throw new GameError(hourly > 0 ? `You cannot afford enough supplies for this hunt. Around ${Math.ceil(hourly * MIN_SUPPLY_HOURS).toLocaleString()} gold buys a short trip.` : 'You cannot afford enough supplies for this hunt.', 402); }
    character.gold -= cost; character.supplies = supplies;
  }
  character.lastHuntId = huntId; ensureHuntTask(character, huntId); const stats = deriveStats(character); character.health = stats.maxHealth; character.mana = stats.maxMana;
  character.staminaRestMs = 0; character.staminaRegenCreditMs = 0;
  const session = startSession(character, huntId, seed); session.boostedMonsterId = dailyBoostedMonster()?.id; session.startedAt = Date.now(); return session;
}
export function endHunt(session: HuntSession): { gold: number; refund: number; character: CharacterState } {
  const character = session.character; const stash = Boolean(character.policy.lootToWarehouse); const pouch = stash ? 0 : pouchSellValue(session); const refund = suppliesCost(character.supplies);
  if (stash) movePouchToWarehouse(session); else session.totals.lootByItem = {};
  character.gold += pouch + refund; character.supplies = [];
  if (session.status === 'boss_cleared') { const encounterId = parseBossHuntId(session.huntId); if (encounterId) recordBossKill(character, encounterId, Date.now()); }
  // Returning to the city always restores the character's vitals. This keeps
  // the persistent party HUD in sync and prevents a stopped hunt snapshot from
  // leaving the principal (or another member) with stale partial HP/MP.
  const stats = deriveStats(character); character.health = stats.maxHealth; character.mana = stats.maxMana;
  return { gold: pouch, refund, character };
}
export const summarise = describeSession;
