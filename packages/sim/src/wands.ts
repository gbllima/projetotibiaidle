import { itemsById, wandsById, type CombatType, type Item, type WandStats } from '@tibia-idle/data';
import { isMagicVocation } from './character.js';
import type { CharacterState } from './types.js';

const WAND_COMBAT: Record<string, CombatType> = {
  energy: 'COMBAT_ENERGYDAMAGE',
  fire: 'COMBAT_FIREDAMAGE',
  ice: 'COMBAT_ICEDAMAGE',
  earth: 'COMBAT_EARTHDAMAGE',
  death: 'COMBAT_DEATHDAMAGE',
  holy: 'COMBAT_HOLYDAMAGE',
};

export const STARTER_WAND_ID = 3074;
export const STARTER_ROD_ID = 3066;

export interface WandAttack {
  min: number;
  max: number;
  mana: number;
  damageType: CombatType;
  shoot: string;
}

export function isWandWeapon(item: Item | null | undefined): boolean {
  return item?.weaponType === 'wand';
}

export function isRodWeapon(item: Item): boolean {
  return item.type === 'rods' || /\brod\b/i.test(item.name);
}

/** Sorcerers use wands; druids use rods. Both are `weaponType=wand` in items.xml. */
export function isCasterWeapon(item: Item, vocationId: number): boolean {
  if (!isWandWeapon(item)) return false;
  const rod = isRodWeapon(item);
  if (vocationId === 2 || vocationId === 6) return rod;
  if (vocationId === 1 || vocationId === 5) return !rod;
  return true;
}

export function equippedWand(character: CharacterState): Item | null {
  const item = itemsById.get(character.equipment.left ?? character.equipment.right ?? 0) ?? null;
  return isWandWeapon(item) ? item : null;
}

function profileFrom(stats: WandStats): WandAttack {
  const element = (stats.wandType ?? stats.shootType ?? 'energy').toLowerCase();
  const shoot = (stats.shootType ?? element).toUpperCase();
  return {
    min: Math.max(1, stats.fromDamage),
    max: Math.max(stats.fromDamage, stats.toDamage),
    mana: Math.max(0, stats.mana),
    damageType: WAND_COMBAT[element] ?? 'COMBAT_ENERGYDAMAGE',
    shoot: shoot.startsWith('CONST_ANI_') ? shoot : `CONST_ANI_${shoot}`,
  };
}

/**
 * Crystal `WeaponWand`: the missile, element and min/max come from the item,
 * not from melee skill. A mage without a wand still fires the vocation starter.
 */
export function wandAttack(character: CharacterState): WandAttack | null {
  if (!isMagicVocation(character.vocationId)) return null;
  const item = equippedWand(character);
  const stats = item ? wandsById.get(item.id) : undefined;
  if (stats) return profileFrom(stats);
  const fallback = wandsById.get(
    character.vocationId === 2 || character.vocationId === 6 ? STARTER_ROD_ID : STARTER_WAND_ID,
  );
  return fallback ? profileFrom(fallback) : null;
}
