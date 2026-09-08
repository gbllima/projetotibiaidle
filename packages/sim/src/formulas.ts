import type { Stage, Vocation } from '@tibia-idle/data';
import type { Rng } from './rng.js';

/**
 * Combat and progression maths, ported from Crystal Server (Tibia 15.25).
 *
 * Every function cites the C++ or Lua it mirrors. Where this fork deliberately
 * deviates from official Tibia it is called out, because we chose to follow
 * Crystal for consistency with the rest of the data
 * (docs/00-ANALISE-TECNICA.md section 2.2).
 *
 * C++ integer division truncates, so `level / 5` on a uint32 is
 * `Math.floor(level / 5)` here. Getting that wrong shifts minimum damage.
 */

/** Skill index order used by Vocation::skillBase. */
export const SKILL_BASE = [50, 50, 50, 50, 30, 100, 20] as const;

/** Skill levels below this need no tries. `Vocation::getReqSkillTries`. */
export const MIN_SKILL_LEVEL = 10;

/**
 * Crystal hardcodes the attack factor instead of deriving it from fight mode.
 * `Player::getAttackFactor` (src/creatures/players/player.cpp:714), commented
 * "Vocation Adjustment: combat-mode removal compensation".
 */
export const ATTACK_FACTOR = 1.2;

/** Experience needed to *reach* the given level. `Player::getExpForLevel` (player.cpp:4517). */
export function expForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.floor((((l - 6) * l + 17) * l - 12) / 6) * 100;
}

/** Level containing the given total experience. Inverse of `expForLevel`. */
export function levelForExp(experience: number): number {
  let level = 1;
  while (expForLevel(level + 1) <= experience) level += 1;
  return level;
}

/**
 * Level component of spell power. `getBaseDamageHealing` (src/utils/tools.cpp:426).
 *
 *   step = floor((sqrt(2L + 2025) + 5) / 10)
 *   base = floor((L + 1000) / step) + 50 * step - 450
 */
export function baseDamageHealing(level: number): number {
  const step = Math.floor((Math.sqrt(2 * level + 2025) + 5) / 10);
  return Math.floor((level + 1000) / step) + 50 * step - 450;
}

/**
 * Weapon damage ceiling. `Weapons::getMaxWeaponDamage`
 * (src/items/weapons/weapons.cpp:111).
 */
export function maxWeaponDamage(
  level: number,
  attackSkill: number,
  attackValue: number,
  attackFactor: number,
  isMelee: boolean,
): number {
  if (isMelee && attackValue <= 0) return 0;
  const coefficient = isMelee ? 0.085 : 0.09;
  return Math.round(coefficient * attackFactor * attackValue * attackSkill + Math.floor(level / 5));
}

/** Minimum weapon damage: `level / 5` with integer division. */
export function minWeaponDamage(level: number, attackValue: number): number {
  return attackValue > 0 ? Math.floor(level / 5) : 0;
}

/**
 * Crystal `calculateAttackValue` (register_spells.lua) — monk spell backbone.
 * fightModeMultiplier is hardcoded 1.2 (full attack), matching ATTACK_FACTOR.
 */
export function monkAttackValue(level: number, attackSkill: number, weaponDamage: number): number {
  const flatBonus = baseDamageHealing(level);
  const fightFactor = Math.floor(1.2 * weaponDamage);
  const skillFactor = (attackSkill + 4) / 28;
  return flatBonus + fightFactor * skillFactor;
}

/**
 * Crystal `calculateMonkSpellDamage`. Average hit; callers spread ±10%.
 *   total = (basePower * attackValue) / 100 + spellFactor * attackValue
 */
export function monkSpellDamage(
  level: number,
  attackSkill: number,
  weaponDamage: number,
  basePower: number,
  spellFactor: number,
): number {
  const attackValue = monkAttackValue(level, attackSkill, weaponDamage);
  return (basePower * attackValue) / 100 + spellFactor * attackValue;
}

/**
 * Crystal `spellSkillDamage` (register_spells.lua) — exori / exori gran backbone.
 *   avg = levelBonus + (basePower / 1000) * skill * attack + basePower / 6
 */
export function spellSkillDamage(
  basePower: number,
  level: number,
  skill: number,
  attack: number,
): number {
  return baseDamageHealing(level) + (basePower / 1000) * skill * attack + basePower / 6;
}

/**
 * Spell damage range. `Combat::getLevelFormula` (combat.cpp:43) feeding
 * `getCombatDamage` (combat.cpp:223).
 *
 *   levelFormula = base(level) * 2 + magicLevel * 3
 *   damage       = normal_random(levelFormula * mina + minb,
 *                                levelFormula * maxa + maxb)
 */
export function spellDamageRange(
  level: number,
  magicLevel: number,
  mina: number,
  minb: number,
  maxa: number,
  maxb: number,
): { min: number; max: number } {
  const levelFormula = baseDamageHealing(level) * 2 + magicLevel * 3;
  return {
    min: Math.trunc(levelFormula * mina + minb),
    max: Math.trunc(levelFormula * maxa + maxb),
  };
}

/**
 * Player defense value. `Player::getDefense` (player.cpp:646).
 *
 * Crystal-specific: a real shield gets +30% and a spellbook +60% over its
 * printed defense, and the scaling factor depends on what is equipped.
 */
export function playerDefense(
  shieldSkill: number,
  shieldDefense: number,
  weaponDefense: number,
  vocation: Vocation,
  { hasShield = false, isSpellbook = false }: { hasShield?: boolean; isSpellbook?: boolean } = {},
): number {
  const boosted = hasShield
    ? Math.floor((shieldDefense * (isSpellbook ? 160 : 130)) / 100)
    : 0;
  const defenseValue = Math.max(boosted, weaponDefense);
  if (defenseValue <= 0) return 0;

  const scaling = hasShield ? 0.16 : weaponDefense > 0 ? 0.146 : 0.15;
  // Fight mode is removed in this fork, so the defense factor is always 1.
  return (shieldSkill / 4 + 2.23) * defenseValue * 1 * scaling * vocation.defense;
}

/**
 * Damage reduction chain. `Creature::blockHit` (src/creatures/creature.cpp:875).
 * Order matters: absorb, then defense, then armour, then mitigation.
 */
export function applyDefenses(
  damage: number,
  {
    absorbPercent = 0,
    defense = 0,
    armor = 0,
    mitigation = 0,
    canUseDefense = true,
  }: {
    absorbPercent?: number;
    defense?: number;
    armor?: number;
    mitigation?: number;
    canUseDefense?: boolean;
  },
  rng: Rng,
): number {
  let result = damage;

  if (absorbPercent > 0) {
    result -= Math.round((result * absorbPercent) / 100);
  }

  if (canUseDefense && defense > 0) {
    result -= rng.uniform(Math.floor(defense / 2), Math.floor(defense));
  }

  if (armor > 3) {
    result -= rng.uniform(Math.floor(armor / 2), armor - ((armor % 2) + 1));
  } else if (armor > 0) {
    result -= 1;
  }

  if (mitigation > 0) {
    result -= (result * mitigation) / 100;
  }

  return Math.max(0, Math.floor(result));
}

/**
 * Elemental resistance on monsters. `Monster::getDamageMultiplier`-adjacent
 * logic in monster.cpp:937. Positive percent resists, negative amplifies.
 */
export function applyElementalResistance(damage: number, resistancePercent: number): number {
  if (!resistancePercent) return damage;
  return Math.max(0, Math.round((damage * (100 - resistancePercent)) / 100));
}

/**
 * Player mitigation. `PlayerWheel::calculateMitigation`
 * (src/creatures/players/wheel/player_wheel.cpp:4079), without wheel bonuses.
 */
export function playerMitigation(shieldSkill: number, defenseValue: number, vocation: Vocation, hasShield: boolean): number {
  const shieldFactor = hasShield ? vocation.mitigationPrimaryShield : vocation.mitigationSecondaryShield;
  const raw = ((shieldSkill * vocation.mitigationMultiplier + shieldFactor * defenseValue) / 100) * 1 * 1;
  return Math.min(45, Math.ceil(raw * 100) / 100);
}

/**
 * Monster mitigation, capped at 45%. `Monster::getMitigation` (monster.cpp:920).
 * The stored `mitigation` field is a small float (0.07 for a rat, 0.99 for a
 * dragon) that the engine scales by 1.5.
 */
export function monsterMitigation(mitigation: number): number {
  return Math.min(45, mitigation * 1.5);
}

/** Tries needed for the next skill level. `Vocation::getReqSkillTries` (vocation.cpp:376). */
export function reqSkillTries(skillIndex: number, level: number, multiplier: number): number {
  if (level <= MIN_SKILL_LEVEL) return 0;
  const base = SKILL_BASE[skillIndex] ?? 50;
  return Math.floor(base * multiplier ** (level - (MIN_SKILL_LEVEL + 1)));
}

/** Mana needed for the next magic level. `Vocation::getReqMana` (vocation.cpp:406). */
export function reqMana(magicLevel: number, manaMultiplier: number): number {
  if (magicLevel === 0) return 0;
  return Math.floor(1600 * manaMultiplier ** (magicLevel - 1));
}

/** `MAX_LOOTCHANCE` (src/utils/const.hpp:20). */
export const MAX_LOOT_CHANCE = 100000;

/** `SCHEDULE_LOOT_RATE` (data/global.lua:56). A percentage, so 100 means x1. */
export const SCHEDULE_LOOT_RATE = 100;

/**
 * One loot roll. `getLootRandom` (data/libs/functions/functions.lua:68) feeding
 * `MonsterType:generateLootRoll` (monstertype.lua:98).
 *
 *   multi     = rateLoot * SCHEDULE_LOOT_RATE
 *   randValue = random(0, 100000) * 100 / max(1, multi)
 *   drops when randValue < chance * factor
 *
 * At the default rates `multi` is 100, so the `* 100` cancels out and the roll
 * is a plain `random(0, 100000)` against the chance. Dropping the schedule rate
 * makes every roll 100x too large and loot effectively never drops.
 *
 * Returns the roll when the item drops (the engine reuses it to pick the stack
 * size) and null otherwise.
 */
export function rollLootEntry(chance: number, factor: number, lootRate: number, rng: Rng): number | null {
  const multi = lootRate * SCHEDULE_LOOT_RATE;
  const randValue = (rng.uniform(0, MAX_LOOT_CHANCE) * 100) / Math.max(1, multi);
  return randValue < chance * factor ? randValue : null;
}

/**
 * Stack size for a dropped item. `monstertype.lua:108`:
 *
 *   count = max(0, randValue % (maxCount - minCount + 1)) + minCount
 *
 * Reusing the roll is what makes rare drops usually arrive in small stacks.
 */
export function lootCount(randValue: number, minCount: number, maxCount: number): number {
  if (maxCount <= minCount) return Math.max(1, minCount);
  return Math.max(0, Math.floor(randValue) % (maxCount - minCount + 1)) + minCount;
}

/**
 * Random per-kill loot factor. `MonsterType:generateLootRoll`
 * (monstertype.lua:89) jitters by +/-5%.
 */
export function lootFactor(rng: Rng, base = 1): number {
  return base * (rng.uniform(95, 105) / 100);
}

/**
 * Stamina multiplier on experience.
 * `getFinalBonusStamina` (data/libs/functions/player.lua:434).
 */
export function staminaMultiplier(staminaMinutes: number, premium: boolean): number {
  if (staminaMinutes <= 0) return 0;
  if (staminaMinutes > 2340 && premium) return 1.5;
  if (staminaMinutes > 840) return 1;
  return 0.5;
}

/** Loot is withheld below this stamina. `Player::canReceiveLoot` (player_functions.cpp:4222). */
export function canReceiveLoot(staminaMinutes: number): boolean {
  return staminaMinutes > 840;
}

/** Multiplier for the stage table covering this level. `data/stages.lua`. */
export function stageMultiplier(stages: readonly Stage[], level: number): number {
  for (const stage of stages) {
    if (level < stage.minLevel) continue;
    if (stage.maxLevel !== null && level > stage.maxLevel) continue;
    return stage.multiplier;
  }
  return 1;
}

/** Hit points, mana and capacity granted per level. `vocations.xml`. */
export function levelGains(vocation: Vocation): { hp: number; mana: number; cap: number } {
  return { hp: vocation.gainHp, mana: vocation.gainMana, cap: vocation.gainCap * 100 };
}

/** Progress toward the next level, 0-100 with two decimals. `Player::getPercentLevel` (player.cpp:3802). */
export function percentLevel(count: number, nextLevelCount: number): number {
  if (nextLevelCount <= 0) return 0;
  return Math.min(100, Math.round(((count * 100) / nextLevelCount) * 100) / 100);
}
