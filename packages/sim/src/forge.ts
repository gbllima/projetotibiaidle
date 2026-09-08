import type { Rng } from './rng.js';
import type { CharacterState } from './types.js';

/**
 * Exaltation Forge materials — Crystal `config.lua` / `exaltation_forge.lua`.
 *
 * Dust fusion cost stays flat 100. Slivers drop from fiendish only (3–7).
 * Conversions: 20 dust → 3 slivers; 50 slivers → 1 exalted core.
 */

export const FORGE_FUSION_DUST_COST = 100;
export const FORGE_DUST_LEVEL_DEFAULT = 100;
export const FORGE_DUST_LEVEL_MAX = 225;
export const FORGE_AMOUNT_MULTIPLIER = 3;

/** Crystal `config.lua`: forgeBaseSuccessRate / forgeBonusSuccessRate / forgeTierLossReduction. */
export const FORGE_BASE_SUCCESS_RATE = 50;
export const FORGE_BONUS_SUCCESS_RATE = 15;
/** With the reduce-tier-loss core: chance (%) that the sacrificed side still drops a tier on fail. Without the core this is 100%. */
export const FORGE_TIER_LOSS_REDUCTION = 50;

/** Crystal dust costs for transfer / convergence (`config.lua`). */
export const FORGE_TRANSFER_DUST_COST = 100;
export const FORGE_CONVERGENCE_FUSION_DUST_COST = 130;
export const FORGE_CONVERGENCE_TRANSFER_DUST_COST = 160;

/**
 * Crystal `item_tiers.lua` classification 4 — only class with convergence prices.
 * Key = target classification tier (1–10).
 */
export type ForgeTierPrice = {
  regular: number;
  cores: number;
  convergenceFusion: number;
  convergenceTransfer: number;
};

export const FORGE_CLASS4_TIERS: Readonly<Record<number, ForgeTierPrice>> = {
  1: { regular: 8_000_000, cores: 1, convergenceFusion: 55_000_000, convergenceTransfer: 65_000_000 },
  2: { regular: 20_000_000, cores: 2, convergenceFusion: 110_000_000, convergenceTransfer: 165_000_000 },
  3: { regular: 40_000_000, cores: 5, convergenceFusion: 170_000_000, convergenceTransfer: 375_000_000 },
  4: { regular: 65_000_000, cores: 10, convergenceFusion: 300_000_000, convergenceTransfer: 800_000_000 },
  5: { regular: 100_000_000, cores: 15, convergenceFusion: 875_000_000, convergenceTransfer: 2_000_000_000 },
  6: { regular: 250_000_000, cores: 25, convergenceFusion: 2_350_000_000, convergenceTransfer: 5_250_000_000 },
  7: { regular: 750_000_000, cores: 35, convergenceFusion: 6_950_000_000, convergenceTransfer: 14_500_000_000 },
  8: { regular: 2_500_000_000, cores: 50, convergenceFusion: 21_250_000_000, convergenceTransfer: 42_500_000_000 },
  9: { regular: 8_000_000_000, cores: 60, convergenceFusion: 50_000_000_000, convergenceTransfer: 100_000_000_000 },
  10: { regular: 15_000_000_000, cores: 85, convergenceFusion: 125_000_000_000, convergenceTransfer: 300_000_000_000 },
};

export function forgeTierPrice(tier: number): ForgeTierPrice | null {
  const entry = FORGE_CLASS4_TIERS[Math.floor(tier)];
  return entry ?? null;
}

/** Final fusion success % after optional success core (+15). */
export function forgeFusionSuccessChance(useCore = false): number {
  return FORGE_BASE_SUCCESS_RATE + (useCore ? FORGE_BONUS_SUCCESS_RATE : 0);
}

/** Crystal: forgeCostOneSliver / forgeSliverAmount — 20 dust buys 3 slivers. */
export const FORGE_DUST_PER_SLIVER_PACK = 20;
export const FORGE_SLIVERS_PER_PACK = 3;
/** Crystal: forgeCoreCost — 50 slivers → 1 core. */
export const FORGE_SLIVERS_PER_CORE = 50;
export const FORGE_MIN_SLIVERS = 3;
export const FORGE_MAX_SLIVERS = 7;

/** Chance a normal kill rolls as influenced / fiendish (idle spawn proxy). */
export const FORGE_INFLUENCED_CHANCE = 0.03;
export const FORGE_FIENDISH_CHANCE = 0.0015;
export const FORGE_INFLUENCED_BOSS_CHANCE = 0.06;
export const FORGE_FIENDISH_BOSS_CHANCE = 0.004;

export type ForgeDrop = {
  dust: number;
  slivers: number;
  kind: 'influenced' | 'fiendish';
};

/** Crystal: amount = uniform(stack, forgeAmountMultiplier * stack). */
export function dustFromStack(stack: number, rng: Rng): number {
  const s = Math.max(1, Math.floor(stack));
  return rng.uniform(s, FORGE_AMOUNT_MULTIPLIER * s);
}

export function addForgeDust(character: CharacterState, amount: number): number {
  if (amount <= 0) return 0;
  character.forgeDust ??= 0;
  character.forgeDustLevel ??= FORGE_DUST_LEVEL_DEFAULT;
  const room = Math.max(0, character.forgeDustLevel - character.forgeDust);
  const gained = Math.min(room, Math.floor(amount));
  character.forgeDust += gained;
  return gained;
}

export function addForgeSlivers(character: CharacterState, amount: number): number {
  if (amount <= 0) return 0;
  character.forgeSlivers ??= 0;
  const gained = Math.floor(amount);
  character.forgeSlivers += gained;
  return gained;
}

export function addForgeCores(character: CharacterState, amount: number): number {
  if (amount <= 0) return 0;
  character.forgeCores ??= 0;
  const gained = Math.floor(amount);
  character.forgeCores += gained;
  return gained;
}

/**
 * Idle proxy for Crystal forge creatures.
 * Influenced: dust only. Fiendish: dust + 3–7 slivers.
 */
export function rollForgeDustOnKill(
  character: CharacterState,
  rng: Rng,
  isBoss = false,
  monsterId?: string,
): ForgeDrop | null {
  const species = monsterId ? Math.min(100, character.forge?.[monsterId] ?? 0) : 0;
  const influenceBonus = species * 0.0002;
  const fiendishChance = isBoss ? FORGE_FIENDISH_BOSS_CHANCE : FORGE_FIENDISH_CHANCE;
  const influencedChance = (isBoss ? FORGE_INFLUENCED_BOSS_CHANCE : FORGE_INFLUENCED_CHANCE) + influenceBonus;
  const roll = rng.uniform(0, 1_000_000) / 1_000_000;

  let stack = 0;
  let kind: 'influenced' | 'fiendish' | null = null;
  if (roll < fiendishChance) {
    stack = 15;
    kind = 'fiendish';
  } else if (roll < fiendishChance + influencedChance) {
    stack = rng.uniform(1, 5);
    kind = 'influenced';
  }
  if (!kind) return null;

  const dust = addForgeDust(character, dustFromStack(stack, rng));
  let slivers = 0;
  if (kind === 'fiendish') {
    slivers = addForgeSlivers(character, rng.uniform(FORGE_MIN_SLIVERS, FORGE_MAX_SLIVERS));
  }
  if (dust <= 0 && slivers <= 0) return null;
  return { dust, slivers, kind };
}

/** Gold to raise the dust cap by 1. Crystal: `cost = dustLevel - 75`. */
export function forgeDustCapCost(level: number): number {
  const current = Math.max(FORGE_DUST_LEVEL_DEFAULT, Math.min(FORGE_DUST_LEVEL_MAX, level));
  return Math.max(1, current - 75) * 1_000;
}

export function raiseForgeDustCap(
  character: CharacterState,
): { ok: true; level: number; cost: number } | { ok: false; reason: string } {
  character.forgeDustLevel ??= FORGE_DUST_LEVEL_DEFAULT;
  if (character.forgeDustLevel >= FORGE_DUST_LEVEL_MAX) {
    return { ok: false, reason: 'Dust limit is already at the maximum.' };
  }
  const cost = forgeDustCapCost(character.forgeDustLevel);
  if (character.gold < cost) {
    return { ok: false, reason: `Need ${cost.toLocaleString('pt-BR')} gold.` };
  }
  character.gold -= cost;
  character.forgeDustLevel += 1;
  return { ok: true, level: character.forgeDustLevel, cost };
}

/** Crystal: spend 20 dust → gain 3 slivers (one pack). */
export function convertDustToSlivers(
  character: CharacterState,
  packs = 1,
): { ok: true; dustSpent: number; sliversGained: number } | { ok: false; reason: string } {
  const count = Math.max(1, Math.floor(packs));
  const dustSpent = FORGE_DUST_PER_SLIVER_PACK * count;
  const sliversGained = FORGE_SLIVERS_PER_PACK * count;
  character.forgeDust ??= 0;
  if (character.forgeDust < dustSpent) {
    return { ok: false, reason: `Need ${dustSpent} forge dust.` };
  }
  character.forgeDust -= dustSpent;
  addForgeSlivers(character, sliversGained);
  return { ok: true, dustSpent, sliversGained };
}

/** Crystal: spend 50 slivers → gain 1 exalted core. */
export function convertSliversToCore(
  character: CharacterState,
  cores = 1,
): { ok: true; sliversSpent: number; coresGained: number } | { ok: false; reason: string } {
  const count = Math.max(1, Math.floor(cores));
  const sliversSpent = FORGE_SLIVERS_PER_CORE * count;
  character.forgeSlivers ??= 0;
  if (character.forgeSlivers < sliversSpent) {
    return { ok: false, reason: `Need ${sliversSpent} forge slivers.` };
  }
  character.forgeSlivers -= sliversSpent;
  addForgeCores(character, count);
  return { ok: true, sliversSpent, coresGained: count };
}
