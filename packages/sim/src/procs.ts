import { itemsById, type SkillName } from '@tibia-idle/data';
import {
  activeImbueTier, IMBUEMENTS, imbueMagicBonus, imbueSkillBonus,
} from './imbuements.js';
import type { CharacterState, EquipSlot } from './types.js';

/**
 * Combat procs ported from Crystal Server 15.25.
 *
 * Critical / leech skills are stored in hundredths of a percent (500 = 5%).
 * Crit rolls `uniform(1,100)*100 <= chance` (combat.cpp:2695).
 * Leech rolls `normal(0,100) >= chance` to *fail* (game.cpp:8580), so chance
 * 100 is effectively always-on — matching Vampirism / Void.
 * Ruse (dodge) and Onslaught (fatal) come from forged item tiers
 * (item.cpp:183, quadraticPoly in tools.hpp:209).
 */

export const ONSLAUGHT = { a: 0.05, b: 0.4, c: 0.05 };
export const RUSE = { a: 0.0307576, b: 0.440697, c: 0.026 };
export const AMPLIFICATION = { a: 0.4, b: 1.7, c: 0.4 };
export const MOMENTUM = { a: 0.05, b: 1.9, c: 0.05 };
/** Crystal `config.lua` transcendenceChanceFormula* — proc from legs tier. */
export const TRANSCENDENCE = { a: 0.0127, b: 0.1070, c: 0.0073 };
/** Crystal `transcendenceAvatarDuration` — forge avatar lasts 7 seconds. */
export const TRANSCENDENCE_AVATAR_MS = 7_000;
/**
 * Forge transcendence forces avatar stage 3 bonuses (`player_wheel.cpp` checkAvatarSkill):
 * 15% incoming damage reduction, +10000 crit chance units (100%), +1500 crit extra (15%).
 */
export const AVATAR_FORGE_DAMAGE_REDUCTION = 15;
export const AVATAR_FORGE_CRIT_CHANCE = 10_000;
export const AVATAR_FORGE_CRIT_EXTRA = 1_500;
export const FATAL_DAMAGE = 0.6;
export const COMBO_WINDOW_TICKS = 8;
export const COMBO_CAP = 20;
export const COMBO_DAMAGE = 0.01;

export function quadraticPoly(a: number, b: number, c: number, x: number): number {
  return a * x * x + b * x + c;
}

export function gearTier(character: CharacterState, slot: EquipSlot): number {
  const stored = character.equipmentTiers?.[slot];
  if (stored !== undefined) return Math.min(10, Math.max(0, Math.floor(stored)));
  if (!character.equipment[slot]) return 0;
  return Math.min(10, Math.max(0, Math.floor((character.level - 80) / 70)));
}

export interface CombatProcs {
  /** Crystal units: 500 = 5%. */
  critChance: number;
  /** Crystal units: 4000 = +40% crit damage. */
  critExtra: number;
  lifeLeechChance: number;
  lifeLeech: number;
  manaLeechChance: number;
  manaLeech: number;
  /** Percent 0-100, after amplification. */
  dodgeChance: number;
  /** Percent 0-100, after amplification. */
  onslaughtChance: number;
  /** Percent 0-100, head tier × amplification (Crystal CONST_SLOT_HEAD). */
  momentumChance: number;
  /** Percent 0-100, legs tier × amplification (Crystal CONST_SLOT_LEGS). */
  transcendenceChance: number;
  /** Percent 0-100 amplification from boots (informational / UI). */
  amplificationPercent: number;
  magicLevel: number;
}

const SKILL_BONUS_KEY: Record<SkillName, string> = {
  fist: 'skillfist',
  club: 'skillclub',
  sword: 'skillsword',
  axe: 'skillaxe',
  distance: 'skilldist',
  shield: 'skillshield',
  fishing: 'skillfishing',
};

export function itemBonus(character: CharacterState, key: string): number {
  let sum = 0;
  for (const id of Object.values(character.equipment)) {
    if (id === undefined) continue;
    sum += itemsById.get(id)?.bonuses[key] ?? 0;
  }
  return sum;
}

export function skillBonusKey(skill: SkillName): string {
  return SKILL_BONUS_KEY[skill];
}

function activeImbue(character: CharacterState, id: string, now = Date.now()): number {
  return activeImbueTier(character, id, now);
}

export function combatProcs(character: CharacterState, now = Date.now()): CombatProcs {
  let critChance = itemBonus(character, 'criticalhitchance');
  let critExtra = itemBonus(character, 'criticalhitdamage');
  let lifeLeechChance = itemBonus(character, 'lifeleechchance');
  let lifeLeech = itemBonus(character, 'lifeleechamount');
  let manaLeechChance = itemBonus(character, 'manaleechchance');
  let manaLeech = itemBonus(character, 'manaleechamount');
  let magicLevel = character.magicLevel + itemBonus(character, 'magiclevelpoints') + imbueMagicBonus(character, now);

  const strike = activeImbue(character, 'strike', now);
  const strikeSpec = IMBUEMENTS.find((entry) => entry.id === 'strike');
  if (strike >= 0 && strikeSpec && strikeSpec.kind === 'critical') {
    critChance += strikeSpec.critChance;
    critExtra += strikeSpec.critExtra[strike] ?? 0;
  }

  const vamp = activeImbue(character, 'vampirism', now);
  const vampSpec = IMBUEMENTS.find((entry) => entry.id === 'vampirism');
  if (vamp >= 0 && vampSpec && vampSpec.kind === 'lifeLeech') {
    lifeLeechChance += 100;
    lifeLeech += Math.round((vampSpec.leech[vamp] ?? 0) * 10000);
  }

  const voided = activeImbue(character, 'void', now);
  const voidSpec = IMBUEMENTS.find((entry) => entry.id === 'void');
  if (voided >= 0 && voidSpec && voidSpec.kind === 'manaLeech') {
    manaLeechChance += 100;
    manaLeech += Math.round((voidSpec.manaLeech[voided] ?? 0) * 10000);
  }

  const weaponTier = gearTier(character, 'left');
  const armorTier = gearTier(character, 'armor');
  const bootTier = gearTier(character, 'feet');
  const headTier = gearTier(character, 'head');
  const legsTier = gearTier(character, 'legs');
  const amplificationPercent = bootTier > 0
    ? quadraticPoly(AMPLIFICATION.a, AMPLIFICATION.b, AMPLIFICATION.c, bootTier)
    : 0;
  const amp = bootTier > 0 ? 1 + amplificationPercent / 100 : 1;

  const dodgeChance = armorTier > 0
    ? quadraticPoly(RUSE.a, RUSE.b, RUSE.c, armorTier) * amp
    : 0;
  const onslaughtChance = weaponTier > 0
    ? quadraticPoly(ONSLAUGHT.a, ONSLAUGHT.b, ONSLAUGHT.c, weaponTier) * amp
    : 0;
  // Crystal: Momentum on helmet, Transcendence on legs — both amplified by boots.
  const momentumChance = headTier > 0
    ? quadraticPoly(MOMENTUM.a, MOMENTUM.b, MOMENTUM.c, headTier) * amp
    : 0;
  const transcendenceChance = legsTier > 0
    ? quadraticPoly(TRANSCENDENCE.a, TRANSCENDENCE.b, TRANSCENDENCE.c, legsTier) * amp
    : 0;

  return {
    critChance,
    critExtra,
    lifeLeechChance,
    lifeLeech,
    manaLeechChance,
    manaLeech,
    dodgeChance,
    onslaughtChance,
    momentumChance,
    transcendenceChance,
    amplificationPercent,
    magicLevel,
  };
}

/** Re-export for callers that boost skills from imbues. */
export { imbueSkillBonus };

export function comboMultiplier(combo: number): number {
  return 1 + Math.max(0, Math.min(COMBO_CAP, combo) - 1) * COMBO_DAMAGE;
}

export function leechAmount(damage: number, skill: number, targets = 1): number {
  if (damage <= 0 || skill <= 0) return 0;
  const raw = damage * (skill / 10000) * (0.1 * targets + 0.9) / targets;
  return Math.max(0, Math.min(damage, Math.round(raw)));
}
