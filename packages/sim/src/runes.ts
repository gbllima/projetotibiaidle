import { itemsById, type CombatType } from '@tibia-idle/data';
import { isDistanceVocation, isMagicVocation } from './character.js';
import { baseDamageHealing } from './formulas.js';
import { magicDamageRange } from './spells.js';
import type { CharacterState, HuntPolicy } from './types.js';

/**
 * Attack runes from data/scripts/runes/.
 *
 * They share the attack group cooldown with spells (2 s), so the helper
 * picks whichever of the ready spell and the configured rune deals more
 * damage this tick. That is the Tibia rotation: SD instead of a strike,
 * explosion instead of waiting on exori, never both on the same group.
 */

export interface AttackRune {
  itemId: number;
  name: string;
  level: number;
  magicLevel: number;
  basePower: number;
  damageType: CombatType;
  area: boolean;
  cooldown: number;
  shoot: string;
  vocations: number[];
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SORCERER = [1, 5];
const DRUID = [2, 6];
const PALADIN = [3, 7];

export const ATTACK_RUNES: AttackRune[] = [
  {
    itemId: 3174, name: 'light magic missile rune',
    level: 15, magicLevel: 0, basePower: 15,
    damageType: 'COMBAT_ENERGYDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_ENERGY', vocations: ALL,
  },
  {
    itemId: 3198, name: 'heavy magic missile rune',
    level: 25, magicLevel: 3, basePower: 30,
    damageType: 'COMBAT_ENERGYDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_ENERGY', vocations: ALL,
  },
  {
    itemId: 3179, name: 'stalagmite rune',
    level: 24, magicLevel: 3, basePower: 50,
    damageType: 'COMBAT_EARTHDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_EARTH', vocations: ALL,
  },
  {
    itemId: 3158, name: 'icicle rune',
    level: 28, magicLevel: 4, basePower: 60,
    damageType: 'COMBAT_ICEDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_ICE', vocations: ALL,
  },
  {
    itemId: 3200, name: 'explosion rune',
    level: 31, magicLevel: 6, basePower: 60,
    damageType: 'COMBAT_PHYSICALDAMAGE', area: true, cooldown: 2000,
    shoot: 'CONST_ANI_EXPLOSION', vocations: ALL,
  },
  {
    itemId: 3191, name: 'great fireball rune',
    level: 30, magicLevel: 4, basePower: 50,
    damageType: 'COMBAT_FIREDAMAGE', area: true, cooldown: 2000,
    shoot: 'CONST_ANI_FIRE', vocations: SORCERER,
  },
  {
    itemId: 3202, name: 'thunderstorm rune',
    level: 28, magicLevel: 4, basePower: 50,
    damageType: 'COMBAT_ENERGYDAMAGE', area: true, cooldown: 2000,
    shoot: 'CONST_ANI_ENERGYBALL', vocations: SORCERER,
  },
  {
    itemId: 3161, name: 'avalanche rune',
    level: 30, magicLevel: 4, basePower: 50,
    damageType: 'COMBAT_ICEDAMAGE', area: true, cooldown: 2000,
    shoot: 'CONST_ANI_ICE', vocations: DRUID,
  },
  {
    itemId: 3175, name: 'stone shower rune',
    level: 28, magicLevel: 4, basePower: 50,
    damageType: 'COMBAT_EARTHDAMAGE', area: true, cooldown: 2000,
    shoot: 'CONST_ANI_EARTH', vocations: DRUID,
  },
  {
    itemId: 3155, name: 'sudden death rune',
    level: 45, magicLevel: 15, basePower: 150,
    damageType: 'COMBAT_DEATHDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_SUDDENDEATH', vocations: SORCERER,
  },
  {
    itemId: 3182, name: 'holy missile rune',
    level: 27, magicLevel: 4, basePower: 70,
    damageType: 'COMBAT_HOLYDAMAGE', area: false, cooldown: 2000,
    shoot: 'CONST_ANI_HOLY', vocations: PALADIN,
  },
];

export function runeById(itemId: number): AttackRune | undefined {
  return ATTACK_RUNES.find((rune) => rune.itemId === itemId);
}

export function runesFor(vocationId: number, level: number, magicLevel: number): AttackRune[] {
  return ATTACK_RUNES.filter((rune) => (
    rune.vocations.includes(vocationId)
    && level >= rune.level
    && magicLevel >= rune.magicLevel
  ));
}

export function runeDamage(rune: AttackRune, level: number, magicLevel: number): { min: number; max: number } {
  return magicDamageRange(baseDamageHealing(level), magicLevel, rune.basePower);
}

export function runeUseCost(itemId: number): number {
  const item = itemsById.get(itemId);
  const charges = Math.max(1, item?.charges ?? 1);
  return (item?.buyPrice ?? 0) / charges;
}

function scoreRune(rune: AttackRune, targets: number): number {
  return (rune.basePower * (rune.area ? Math.max(1, targets) : 1)) / (rune.cooldown / 1000);
}

/** Strongest rune this vocation can throw at this level. */
export function bestRune(vocationId: number, level: number, magicLevel: number, targets = 1): AttackRune | null {
  let best: AttackRune | null = null;
  let bestScore = -1;
  for (const rune of runesFor(vocationId, level, magicLevel)) {
    const score = scoreRune(rune, targets);
    if (score > bestScore) {
      bestScore = score;
      best = rune;
    }
  }
  return best;
}

/**
 * Rune the helper will throw this tick, or null when runes are off / unaffordable.
 *
 * `runeId` 0 means auto (best DPS among runes the character can use). A
 * specific id is used only if the character meets the rune's requirements.
 */
export function chooseRune(
  character: CharacterState,
  policy: HuntPolicy | undefined,
  targets = 1,
): AttackRune | null {
  const runeId = policy?.runeId ?? -1;
  if (runeId < 0) return null;
  const preferred = runeId > 0 ? runeById(runeId) : null;
  const rune = preferred && preferred.vocations.includes(character.vocationId)
    && character.level >= preferred.level
    && character.magicLevel >= preferred.magicLevel
    ? preferred
    : bestRune(character.vocationId, character.level, character.magicLevel, targets);
  if (!rune) return null;
  if (!character.supplies.some((stack) => stack.itemId === rune.itemId && stack.count > 0)) return null;
  return rune;
}

export function defaultRuneFor(character: CharacterState): AttackRune | null {
  if (isMagicVocation(character.vocationId) || isDistanceVocation(character.vocationId) || character.vocationId === 9 || character.vocationId === 10) {
    return bestRune(character.vocationId, character.level, character.magicLevel, 3);
  }
  return bestRune(character.vocationId, character.level, character.magicLevel, 8);
}
