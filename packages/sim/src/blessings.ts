import { SKILL_NAMES, getVocation } from '@tibia-idle/data';
import { consumeAmuletOfLoss } from './jewelry.js';
import { dropPouchFraction } from './loot.js';
import { expForLevel, reqMana, reqSkillTries } from './formulas.js';
import type { CharacterState, HuntSession } from './types.js';

/** The five PvE blessings. Each one is consumed on death. */
export const BLESSING_CAP = 5;

export const BLESSING_NAMES = [
  { id: 1, pt: 'Sabedoria da Solidão', en: 'The Wisdom of Solitude' },
  { id: 2, pt: 'Faísca da Fênix', en: 'The Spark of the Phoenix' },
  { id: 3, pt: 'Fogo dos Sóis', en: 'The Fire of the Suns' },
  { id: 4, pt: 'Proteção Espiritual', en: 'The Spiritual Shielding' },
  { id: 5, pt: 'Abraço de Tibia', en: 'The Embrace of Tibia' },
] as const;

export interface DeathPenaltyResult {
  lost: number;
  blessingsUsed: number;
  rate: number;
  aolUsed: boolean;
  pouchLost: number;
  /** Combined skill + magic levels lost. */
  skillsLost: number;
}
/** Tibia PvE blessing bit ids (Crystal ids 2–32, skip Twist of Fate). */
export const BLESSING_BITS = [2, 4, 8, 16, 32] as const;

/** Legacy saves stored 0–5 as a count; bitmask after `blessingsVersion >= 1`. */
export function normalizeBlessingMask(value: number): number {
  return BLESSING_BITS.reduce((mask, bit) => mask | (Math.floor(value) & bit ? bit : 0), 0);
}

export function migrateBlessings(character: { blessings?: number; blessingsVersion?: number }): void {
  if ((character.blessingsVersion ?? 0) >= 1) {
    character.blessings = normalizeBlessingMask(character.blessings ?? 0);
    return;
  }
  const count = Math.min(BLESSING_CAP, Math.max(0, Math.floor(character.blessings ?? 0)));
  let mask = 0;
  for (let i = 0; i < count; i += 1) mask |= BLESSING_BITS[i]!;
  character.blessings = mask;
  character.blessingsVersion = 1;
}

export function blessingCount(value: number): number {
  const mask = normalizeBlessingMask(value);
  return BLESSING_BITS.filter((bit) => mask & bit).length;
}

export function hasBlessing(value: number, index: number): boolean {
  const bit = BLESSING_BITS[index];
  return bit ? (normalizeBlessingMask(value) & bit) !== 0 : false;
}

export function allMainBlessings(value: number): boolean {
  return blessingCount(value) >= BLESSING_CAP;
}

export function missingBlessingIndices(value: number): number[] {
  const mask = normalizeBlessingMask(value);
  return BLESSING_BITS.map((bit, index) => (!(mask & bit) ? index : -1)).filter((i) => i >= 0);
}

/**
 * Temple price from Crystal `Blessings.getBlessingCost` (regular, NPC, non-enhanced).
 * ≤30: 2 000 · 31–119: 200 × (level − 20) · ≥120: 20 000 + 75 × (level − 120).
 */
export function blessingCost(level: number, enhanced = false): number {
  const lv = Math.max(1, Math.floor(level));
  if (lv <= 30) return 2000;
  if (lv >= 120) {
    const base = enhanced ? 26_000 : 20_000;
    const mult = enhanced ? 100 : 75;
    return base + mult * (lv - 120);
  }
  const mult = enhanced ? 260 : 200;
  return mult * (lv - 20);
}

export function buyAllBlessingsCost(level: number, mask: number): number {
  const missing = missingBlessingIndices(mask);
  const unit = blessingCost(level);
  return missing.length * unit;
}

/** XP/skill loss rate from active blessing count (8% reduction each, Tibia store text). */
export function deathLossRate(mask: number): number {
  const count = blessingCount(mask);
  return Math.max(0.02, 0.10 - count * 0.008);
}

/**
 * XP lost on death, plus the idle mapping of item drop.
 *
 * Without blessings: 10% of the current level's span, never enough to drop a
 * level. Each blessing cuts 0.8%, down to 6% with all five (40% reduction).
 *
 * Blessings keep the loot pouch. So does an Amulet of Loss, which is then
 * destroyed. Unprotected deaths drop 20% of the pouch — Tibia's item loss,
 * expressed as gold-valued stacks because the character has no corpse.
 */
export function applyDeathPenalty(
  character: CharacterState,
  session?: HuntSession | null,
): DeathPenaltyResult {
  const mask = normalizeBlessingMask(character.blessings ?? 0);
  const span = Math.max(1, expForLevel(character.level + 1) - expForLevel(character.level));
  const floor = expForLevel(character.level);
  const progress = Math.max(0, character.experience - floor);
  const rate = deathLossRate(mask);
  const lost = Math.floor(Math.min(progress, span * rate));
  character.experience -= lost;
  const skillsLost = applySkillDeathLoss(character, rate);
  character.blessings = 0;

  const count = blessingCount(mask);
  const aolUsed = count === 0 && consumeAmuletOfLoss(character);
  const pouchLost = !aolUsed && count === 0 && session ? dropPouchFraction(session, 0.2) : 0;

  return { lost, blessingsUsed: count, rate, aolUsed, pouchLost, skillsLost };
}

function applySkillDeathLoss(character: CharacterState, rate: number): number {
  if (rate <= 0) return 0;
  const vocation = getVocation(character.vocationId);
  let levelsLost = 0;

  for (const skill of SKILL_NAMES) {
    const state = character.skills[skill];
    if (!state || state.level <= 10) continue;
    const index = SKILL_NAMES.indexOf(skill);
    const multiplier = vocation.skillMultipliers[skill];
    let sumTries = state.tries;
    for (let level = 11; level <= state.level; level += 1) {
      sumTries += reqSkillTries(index, level, multiplier);
    }
    let lostTries = Math.floor(sumTries * rate);
    while (lostTries > state.tries) {
      lostTries -= state.tries;
      if (state.level <= 10) {
        state.level = 10;
        state.tries = 0;
        lostTries = 0;
        break;
      }
      state.tries = reqSkillTries(index, state.level, multiplier);
      state.level -= 1;
      levelsLost += 1;
    }
    state.tries = Math.max(0, state.tries - lostTries);
  }

  if (character.magicLevel > 0) {
    let sumMana = character.manaSpent;
    for (let level = 1; level <= character.magicLevel; level += 1) {
      sumMana += reqMana(level, vocation.manaMultiplier);
    }
    let lostMana = Math.floor(sumMana * rate);
    while (lostMana > character.manaSpent && character.magicLevel > 0) {
      lostMana -= character.manaSpent;
      character.manaSpent = reqMana(character.magicLevel, vocation.manaMultiplier);
      character.magicLevel -= 1;
      levelsLost += 1;
    }
    character.manaSpent = Math.max(0, character.manaSpent - lostMana);
  }

  return levelsLost;
}
