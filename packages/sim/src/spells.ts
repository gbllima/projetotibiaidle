import { itemsById, wandsById, type CombatType } from '@tibia-idle/data';
import { baseDamageHealing, monkSpellDamage, spellSkillDamage } from './formulas.js';
import type { CharacterState, HuntPolicy } from './types.js';

/**
 * Attack spells, transcribed from data/scripts/spells/attack/ and
 * data/scripts/runes/.
 *
 * This is a curated subset rather than a generated file. The server declares
 * spells as executable scripts with per-spell damage callbacks, so extracting
 * all of them faithfully means running the spell engine. The ones here are the
 * damage backbone of each caster vocation and carry the real
 * level/mana/basePower values, which is what the simulation needs.
 *
 * Formulas from register_spells.lua / per-spell callbacks:
 *
 *   calculateMagicSpellDamage: avg = base + ml * sqrt(power * 0.4) + power / 6
 *                              spread 0.88 .. 1.12
 *   spellMagicDamage:          avg = base + (power / 25) * ml + power / 6
 *                              spread depends on the spell, commonly 0.9 .. 1.1
 *   spellSkillDamage:          avg = base + (power / 1000) * skill * atk + power / 6
 *                              (berserk / fierce berserk; ±10%)
 *
 * Knight/paladin weapon spells with custom callbacks keep those formulas by id.
 * Monk attacks use `calculateMonkSpellDamage` (formula `'monk'`).
 */

export type SpellFormula = 'magic' | 'strike' | 'weapon' | 'monk';

/** Crystal spell groups — each ticks its own cooldown independently. */
export type SpellGroup = 'attack' | 'wave' | 'special' | 'ultimate' | 'support';

export interface Spell {
  id: string;
  name: string;
  words: string;
  level: number;
  mana: number;
  basePower: number;
  damageType: CombatType;
  formula: SpellFormula;
  /** Hits every engaged monster. */
  area: boolean;
  /**
   * Crystal createCombatArea id when `area` (self-centered unless noted).
   * divine_caldera / groundshaker = circle3; berserk = square1.
   */
  areaShape?: import('./areas.js').CombatAreaId;
  /** Milliseconds. */
  cooldown: number;
  group: SpellGroup;
  vocations: number[];
  /** Monk Harmony: builders stack, spenders require and consume stacks. */
  harmony?: import('./harmony.js').HarmonyRole;
  /** Crystal `spellFactor` for monk formula (default 0.7). */
  spellFactor?: number;
}

const SORCERER = [1, 5];
const DRUID = [2, 6];
const CASTERS = [...SORCERER, ...DRUID];

export const SPELLS: Spell[] = [
  {
    id: 'flame_strike', name: 'Flame Strike', words: 'exori flam',
    level: 14, mana: 20, basePower: 45,
    damageType: 'COMBAT_FIREDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: CASTERS,
  },
  {
    id: 'ice_strike', name: 'Ice Strike', words: 'exori frigo',
    level: 15, mana: 20, basePower: 45,
    damageType: 'COMBAT_ICEDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: CASTERS,
  },
  {
    id: 'energy_strike', name: 'Energy Strike', words: 'exori vis',
    level: 12, mana: 20, basePower: 40,
    damageType: 'COMBAT_ENERGYDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: CASTERS,
  },
  {
    id: 'fire_wave', name: 'Fire Wave', words: 'exevo flam hur',
    level: 18, mana: 25, basePower: 40,
    damageType: 'COMBAT_FIREDAMAGE', formula: 'magic', area: true, areaShape: 'wave4',
    cooldown: 4000, group: 'wave', vocations: SORCERER,
  },
  {
    id: 'terra_wave', name: 'Terra Wave', words: 'exevo tera hur',
    level: 38, mana: 210, basePower: 120,
    damageType: 'COMBAT_EARTHDAMAGE', formula: 'magic', area: true, areaShape: 'squarewave5',
    cooldown: 4000, group: 'wave', vocations: DRUID,
  },
  {
    id: 'great_fireball', name: 'Great Fireball', words: 'adori mas flam',
    level: 30, mana: 120, basePower: 100,
    damageType: 'COMBAT_FIREDAMAGE', formula: 'magic', area: true, areaShape: 'circle3',
    cooldown: 2000, group: 'attack', vocations: CASTERS,
  },
  {
    id: 'sudden_death', name: 'Sudden Death', words: 'adori gran mort',
    level: 45, mana: 200, basePower: 150,
    damageType: 'COMBAT_DEATHDAMAGE', formula: 'magic', area: false,
    cooldown: 2000, group: 'attack', vocations: SORCERER,
  },
  {
    id: 'strong_ice_wave', name: 'Strong Ice Wave', words: 'exevo gran frigo hur',
    level: 40, mana: 170, basePower: 150,
    damageType: 'COMBAT_ICEDAMAGE', formula: 'magic', area: true, areaShape: 'squarewave5',
    cooldown: 4000, group: 'wave', vocations: DRUID,
  },
  {
    id: 'energy_wave', name: 'Energy Wave', words: 'exevo vis hur',
    level: 38, mana: 170, basePower: 150,
    damageType: 'COMBAT_ENERGYDAMAGE', formula: 'magic', area: true, areaShape: 'squarewave5',
    cooldown: 4000, group: 'wave', vocations: SORCERER,
  },
  {
    id: 'eternal_winter', name: 'Eternal Winter', words: 'exevo gran mas frigo',
    level: 60, mana: 1050, basePower: 200,
    damageType: 'COMBAT_ICEDAMAGE', formula: 'magic', area: true, areaShape: 'circle5',
    cooldown: 40000, group: 'ultimate', vocations: DRUID,
  },
  {
    id: 'hells_core', name: "Hell's Core", words: 'exevo gran mas flam',
    level: 60, mana: 1100, basePower: 250,
    damageType: 'COMBAT_FIREDAMAGE', formula: 'magic', area: true, areaShape: 'circle5',
    cooldown: 40000, group: 'ultimate', vocations: SORCERER,
  },
  // Melee / distance weapon spells. `basePower` matches Crystal spell:basePower
  // (spellSkillDamage for berserk family; custom callbacks for the rest).
  {
    id: 'berserk', name: 'Berserk', words: 'exori',
    level: 35, mana: 125, basePower: 44,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: true, areaShape: 'square1',
    cooldown: 4000, group: 'wave', vocations: [4, 8],
  },
  {
    id: 'front_sweep', name: 'Front Sweep', words: 'exori min',
    level: 70, mana: 200, basePower: 80,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: true, areaShape: 'square1',
    cooldown: 6000, group: 'special', vocations: [4, 8],
  },
  {
    id: 'death_strike', name: 'Death Strike', words: 'exori mort',
    level: 16, mana: 20, basePower: 45,
    damageType: 'COMBAT_DEATHDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: SORCERER,
  },
  {
    id: 'terra_strike', name: 'Terra Strike', words: 'exori tera',
    level: 13, mana: 20, basePower: 45,
    damageType: 'COMBAT_EARTHDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: CASTERS,
  },
  {
    id: 'energy_beam', name: 'Energy Beam', words: 'exevo vis lux',
    level: 23, mana: 40, basePower: 60,
    damageType: 'COMBAT_ENERGYDAMAGE', formula: 'magic', area: true, areaShape: 'beam5',
    cooldown: 4000, group: 'wave', vocations: SORCERER,
  },
  {
    id: 'ice_wave', name: 'Ice Wave', words: 'exevo frigo hur',
    level: 18, mana: 25, basePower: 35,
    damageType: 'COMBAT_ICEDAMAGE', formula: 'magic', area: true, areaShape: 'wave4',
    cooldown: 4000, group: 'wave', vocations: DRUID,
  },
  {
    id: 'whirlwind_throw', name: 'Whirlwind Throw', words: 'exori hur',
    level: 28, mana: 40, basePower: 32,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: false,
    cooldown: 6000, group: 'special', vocations: [4, 8],
  },
  {
    id: 'groundshaker', name: 'Groundshaker', words: 'exori mas',
    level: 33, mana: 200, basePower: 32,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: true, areaShape: 'circle3',
    cooldown: 8000, group: 'special', vocations: [4, 8],
  },
  {
    id: 'brutal_strike', name: 'Brutal Strike', words: 'exori ico',
    level: 16, mana: 30, basePower: 39,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: false,
    cooldown: 6000, group: 'special', vocations: [4, 8],
  },
  {
    id: 'fierce_berserk', name: 'Fierce Berserk', words: 'exori gran',
    level: 90, mana: 360, basePower: 92,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: true, areaShape: 'square1',
    cooldown: 6000, group: 'wave', vocations: [4, 8],
  },
  {
    id: 'annihilation', name: 'Annihilation', words: 'exori gran ico',
    level: 110, mana: 300, basePower: 125,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: false,
    cooldown: 30000, group: 'ultimate', vocations: [4, 8],
  },
  {
    id: 'swift_jab', name: 'Swift Jab', words: 'exori infir pug',
    level: 1, mana: 3, basePower: 12, spellFactor: 0.7,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: false,
    cooldown: 2000, group: 'attack', vocations: [9, 10], harmony: 'build',
  },
  {
    id: 'tiger_clash', name: 'Tiger Clash', words: 'exori infir nia',
    level: 1, mana: 18, basePower: 15, spellFactor: 0.7,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: false,
    cooldown: 8000, group: 'special', vocations: [9, 10], harmony: 'spend',
  },
  {
    id: 'flurry_of_blows', name: 'Flurry of Blows', words: 'exori mas pug',
    level: 35, mana: 110, basePower: 55, spellFactor: 0.6,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: true, areaShape: 'square1',
    cooldown: 4000, group: 'wave', vocations: [9, 10], harmony: 'build',
  },
  {
    id: 'forceful_uppercut', name: 'Forceful Uppercut', words: 'exori gran pug',
    level: 110, mana: 325, basePower: 130, spellFactor: 0.7,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: false,
    cooldown: 40000, group: 'ultimate', vocations: [9, 10], harmony: 'build',
  },
  {
    id: 'devastating_knockout', name: 'Devastating Knockout', words: 'exori gran nia',
    level: 125, mana: 210, basePower: 62, spellFactor: 1.0,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: false,
    cooldown: 24000, group: 'special', vocations: [9, 10], harmony: 'spend',
  },
  {
    id: 'spiritual_outburst', name: 'Spiritual Outburst', words: 'exori gran mas nia',
    level: 300, mana: 425, basePower: 42, spellFactor: 2.5,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: true, areaShape: 'circle3',
    cooldown: 60000, group: 'ultimate', vocations: [9, 10], harmony: 'spend',
  },
  {
    id: 'sweeping_takedown', name: 'Sweeping Takedown', words: 'exori mas nia',
    level: 70, mana: 200, basePower: 48, spellFactor: 1.0,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'monk', area: true, areaShape: 'square1',
    cooldown: 6000, group: 'special', vocations: [9, 10], harmony: 'spend',
  },
  {
    id: 'ethereal_spear', name: 'Ethereal Spear', words: 'exori con',
    level: 23, mana: 25, basePower: 25,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: false,
    cooldown: 2000, group: 'attack', vocations: [3, 7],
  },
  {
    id: 'strong_ethereal_spear', name: 'Strong Ethereal Spear', words: 'exori gran con',
    level: 90, mana: 55, basePower: 38,
    damageType: 'COMBAT_PHYSICALDAMAGE', formula: 'weapon', area: false,
    cooldown: 8000, group: 'special', vocations: [3, 7],
  },
  {
    id: 'divine_missile', name: 'Divine Missile', words: 'exori san',
    level: 40, mana: 20, basePower: 60,
    damageType: 'COMBAT_HOLYDAMAGE', formula: 'strike', area: false,
    cooldown: 2000, group: 'attack', vocations: [3, 7],
  },
  {
    id: 'divine_caldera', name: 'Divine Caldera', words: 'exevo mas san',
    level: 50, mana: 160, basePower: 160,
    damageType: 'COMBAT_HOLYDAMAGE', formula: 'magic', area: true, areaShape: 'circle3',
    cooldown: 4000, group: 'wave', vocations: [3, 7],
  },
];

/** `calculateMagicSpellDamage` from register_spells.lua. Used by spells and runes. */
export function magicDamageRange(levelBonus: number, magicLevel: number, basePower: number): { min: number; max: number } {
  const avg = levelBonus + magicLevel * Math.sqrt(basePower * 0.4) + basePower / 6;
  return { min: Math.floor(avg * 0.88), max: Math.floor(avg * 1.12) };
}

/**
 * Damage range for a spell.
 *
 * `magic` / `strike` — register_spells.lua magic formulas.
 * `weapon` — Crystal skill callbacks (spellSkillDamage or per-spell custom).
 * `monk` — `calculateMonkSpellDamage`.
 *
 * `weaponRange` is unused (kept for call-site compatibility).
 */
export function spellDamage(
  spell: Spell,
  level: number,
  magicLevel: number,
  baseFn: (l: number) => number,
  _weaponRange?: { min: number; max: number },
  weaponStats?: { attackSkill: number; weaponDamage: number },
): { min: number; max: number } {
  if (spell.formula === 'monk') {
    const total = monkSpellDamage(
      level,
      weaponStats?.attackSkill ?? 10,
      weaponStats?.weaponDamage ?? 7,
      spell.basePower,
      spell.spellFactor ?? 0.7,
    );
    return { min: Math.floor(total * 0.9), max: Math.ceil(total * 1.1) };
  }

  if (spell.formula === 'weapon') {
    return weaponSpellDamage(
      spell,
      level,
      weaponStats?.attackSkill ?? 10,
      weaponStats?.weaponDamage ?? 7,
      baseFn,
    );
  }

  const levelBonus = baseFn(level);
  if (spell.formula === 'magic') {
    return magicDamageRange(levelBonus, magicLevel, spell.basePower);
  }
  const avg = levelBonus + (spell.basePower / 25) * magicLevel + spell.basePower / 6;
  return { min: Math.floor(avg * 0.9), max: Math.ceil(avg * 1.1) };
}

/** Per-spell Crystal weapon formulas (skill × attack callbacks). */
function weaponSpellDamage(
  spell: Spell,
  level: number,
  skill: number,
  attack: number,
  baseFn: (l: number) => number,
): { min: number; max: number } {
  const levelBonus = baseFn(level);
  const skillTotal = skill * attack;

  switch (spell.id) {
    case 'brutal_strike': {
      const min = (((skillTotal * 0.02) + 4) + levelBonus) * 1.28;
      const max = (((skillTotal * 0.04) + 9) + levelBonus) * 1.28;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'front_sweep': {
      // Crystal front_sweep.lua — BASE_SCALE = 80/72 after vocation adjust.
      const scale = 80 / 72;
      const min = (((skillTotal * 0.04) + 31) + levelBonus) * 1.1 * scale;
      const max = (((skillTotal * 0.08) + 45) + levelBonus) * 1.1 * scale;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'groundshaker': {
      const min = (levelBonus + (skill + attack) * 0.5) * 1.28;
      const max = (levelBonus + (skill + attack) * 1.1) * 1.28;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'whirlwind_throw': {
      const min = (levelBonus + (skill + attack) / 3) * 1.28;
      const max = (levelBonus + skill + attack) * 1.28;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'annihilation': {
      const min = (((skillTotal * 0.17) + 13) + levelBonus) * 1.28;
      const max = (((skillTotal * 0.20) + 34) + levelBonus) * 1.28;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'ethereal_spear': {
      const min = levelBonus + (skill + 25) / 3;
      const max = levelBonus + skill + 25;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    case 'strong_ethereal_spear': {
      const min = ((2 * skill + attack / 2500) * 2.3) + levelBonus + 7;
      const max = ((2 * skill + attack / 1875) * 3.3) + levelBonus + 13;
      return { min: Math.floor(min), max: Math.ceil(max) };
    }
    default: {
      // berserk / fierce_berserk — spellSkillDamage ±10%.
      const avg = spellSkillDamage(spell.basePower, level, skill, attack);
      return { min: Math.floor(avg * 0.9), max: Math.ceil(avg * 1.1) };
    }
  }
}

/**
 * Best spell the character can cast and afford right now.
 *
 * Scoring must divide by cooldown, not just compare raw power. Hell's Core has
 * more than three times the base power of Great Fireball but a 40 second
 * cooldown against 2 seconds, so picking on power alone makes a level 60
 * sorcerer deal less damage than a level 50 one.
 */
export interface HealSpell {
  id: string;
  name: string;
  words: string;
  level: number;
  mana: number;
  basePower: number;
  vocations: number[];
}

const ALL_VOCATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const HEAL_SPELLS: HealSpell[] = [
  {
    id: 'wound_cleansing', name: 'Wound Cleansing', words: 'exura infir ico',
    level: 8, mana: 20, basePower: 40, vocations: [4, 8],
  },
  {
    id: 'light_healing', name: 'Light Healing', words: 'exura',
    level: 8, mana: 20, basePower: 40, vocations: ALL_VOCATIONS,
  },
  {
    id: 'intense_healing', name: 'Intense Healing', words: 'exura gran',
    level: 20, mana: 70, basePower: 90, vocations: [2, 3, 6, 7],
  },
  {
    id: 'ultimate_healing', name: 'Ultimate Healing', words: 'exura vita',
    level: 30, mana: 160, basePower: 180, vocations: [2, 6],
  },
  {
    id: 'divine_healing', name: 'Divine Healing', words: 'exura san',
    level: 35, mana: 160, basePower: 150, vocations: [3, 7],
  },
];

export function healSpellsFor(vocationId: number, level = 999): HealSpell[] {
  return HEAL_SPELLS.filter((spell) => spell.vocations.includes(vocationId) && level >= spell.level);
}

export function healAmount(spell: HealSpell, level: number, magicLevel: number): { min: number; max: number } {
  const avg = baseDamageHealing(level) + (spell.basePower / 25) * magicLevel + spell.basePower / 6;
  return { min: Math.floor(avg * 0.9), max: Math.ceil(avg * 1.1) };
}

export function spellsFor(vocationId: number, level = 999): Spell[] {
  return SPELLS.filter((spell) => spell.vocations.includes(vocationId) && level >= spell.level);
}

/** Spells pinned to the action bar: priority order, enabled only. */
export function hotbarSpells(vocationId: number, level: number, policy?: HuntPolicy): Spell[] {
  const disabled = new Set(policy?.disabledSpells ?? []);
  const catalog = new Map(spellsFor(vocationId, level).map((spell) => [spell.id, spell]));
  const out: Spell[] = [];
  for (const id of policy?.spellPriority ?? []) {
    if (disabled.has(id)) continue;
    const spell = catalog.get(id);
    if (spell) out.push(spell);
  }
  return out;
}

export const SPELL_GROUPS: SpellGroup[] = ['attack', 'wave', 'special', 'ultimate', 'support'];

export function tickSpellCooldowns(cooldowns: Partial<Record<SpellGroup, number>>): void {
  for (const group of SPELL_GROUPS) {
    const left = cooldowns[group] ?? 0;
    if (left > 0) cooldowns[group] = left - 1;
  }
}

export function isSpellGroupReady(cooldowns: Partial<Record<SpellGroup, number>>, group: SpellGroup): boolean {
  return (cooldowns[group] ?? 0) <= 0;
}

/** Crystal CONST_ME_* shown when the spell is cast (area / impact). */
export function spellEffect(spell: Spell): string | undefined {
  switch (spell.id) {
    case 'berserk':
    case 'fierce_berserk':
    case 'front_sweep':
    case 'flurry_of_blows':
    case 'sweeping_takedown':
    case 'spiritual_outburst':
      return 'CONST_ME_HITAREA';
    case 'groundshaker':
      return 'CONST_ME_GROUNDSHAKER';
    case 'fire_wave':
    case 'great_fireball':
      return 'CONST_ME_HITBYFIRE';
    case 'energy_wave':
    case 'energy_beam':
      return 'CONST_ME_ENERGYAREA';
    case 'terra_wave':
      return 'CONST_ME_SMALLPLANTS';
    case 'ice_wave':
    case 'strong_ice_wave':
      return 'CONST_ME_ICEAREA';
    case 'eternal_winter':
      return 'CONST_ME_ICETORNADO';
    case 'hells_core':
      return 'CONST_ME_FIREAREA';
    case 'divine_caldera':
      return 'CONST_ME_HOLYAREA';
    default:
      break;
  }
  if (!spell.area) return undefined;
  switch (spell.damageType) {
    case 'COMBAT_FIREDAMAGE': return 'CONST_ME_HITBYFIRE';
    case 'COMBAT_ENERGYDAMAGE': return 'CONST_ME_ENERGYAREA';
    case 'COMBAT_ICEDAMAGE': return 'CONST_ME_ICEATTACK';
    case 'COMBAT_EARTHDAMAGE': return 'CONST_ME_HITBYPOISON';
    case 'COMBAT_HOLYDAMAGE': return 'CONST_ME_HOLYAREA';
    case 'COMBAT_DEATHDAMAGE': return 'CONST_ME_MORTAREA';
    case 'COMBAT_PHYSICALDAMAGE': return 'CONST_ME_HITAREA';
    default: return 'CONST_ME_MAGIC_RED';
  }
}

/** Crystal CONST_ANI_* for single-target spells. Area spells use CONST_ME_* only. */
export function spellShoot(spell: Spell): string | undefined {
  if (spell.area) return undefined;
  if (spell.id === 'whirlwind_throw') return 'CONST_ANI_WHIRLWINDSWORD';
  if (spell.id.includes('ethereal')) return 'CONST_ANI_ETHEREALSPEAR';
  if (spell.formula === 'weapon' || spell.formula === 'monk') return 'CONST_ANI_WHIRLWINDSWORD';
  switch (spell.damageType) {
    case 'COMBAT_FIREDAMAGE': return 'CONST_ANI_FIRE';
    case 'COMBAT_ENERGYDAMAGE': return 'CONST_ANI_ENERGY';
    case 'COMBAT_ICEDAMAGE': return 'CONST_ANI_ICE';
    case 'COMBAT_EARTHDAMAGE': return 'CONST_ANI_EARTH';
    case 'COMBAT_DEATHDAMAGE': return spell.id === 'sudden_death' ? 'CONST_ANI_SUDDENDEATH' : 'CONST_ANI_DEATH';
    case 'COMBAT_HOLYDAMAGE': return 'CONST_ANI_HOLY';
    default: return undefined;
  }
}

/** Missile for a melee auto-attack, matching the equipped weapon family. */
export function weaponMissile(character: CharacterState): string {
  const item = itemsById.get(character.equipment.left ?? character.equipment.right ?? 0);
  if (item?.weaponType === 'wand') {
    const shoot = (wandsById.get(item.id)?.shootType ?? 'energy').toUpperCase();
    return shoot.startsWith('CONST_ANI_') ? shoot : `CONST_ANI_${shoot}`;
  }
  const type = item?.weaponType ?? character.startWeapon;
  if (type === 'axe') return 'CONST_ANI_WHIRLWINDAXE';
  if (type === 'club') return 'CONST_ANI_WHIRLWINDCLUB';
  return 'CONST_ANI_WHIRLWINDSWORD';
}

export function chooseSpell(
  vocationId: number,
  level: number,
  mana: number,
  targetCount: number,
  policy?: HuntPolicy,
  isGroupReady: (group: SpellGroup) => boolean = () => true,
  harmony = 0,
): Spell | null {
  const disabled = new Set(policy?.disabledSpells ?? []);
  const available = SPELLS.filter((spell) => (
    spell.vocations.includes(vocationId)
    && level >= spell.level
    && mana >= spell.mana
    && !disabled.has(spell.id)
    && isGroupReady(spell.group)
    && (spell.harmony !== 'spend' || harmony > 0)
  ));

  for (const id of policy?.spellPriority ?? []) {
    const preferred = available.find((spell) => spell.id === id);
    if (preferred) return preferred;
  }

  let best: Spell | null = null;
  let bestScore = -1;
  for (const spell of available) {
    const targets = spell.area ? Math.max(1, targetCount) : 1;
    let score = (spell.basePower * targets) / (spell.cooldown / 1000);
    // Prefer spending at high stacks — Crystal players dump at 4–5.
    if (spell.harmony === 'spend' && harmony >= 3) score *= 1 + harmony * 0.35;
    if (spell.harmony === 'build' && harmony >= HARMONY_MAX_HINT) score *= 0.55;
    if (score > bestScore) {
      bestScore = score;
      best = spell;
    }
  }
  return best;
}

const HARMONY_MAX_HINT = 5;
