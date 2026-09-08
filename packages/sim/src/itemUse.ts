import { itemsById, type Item } from '@tibia-idle/data';
import { deriveStats } from './character.js';
import { slotFor } from './gear.js';
import { takeItemStack } from './loot.js';
import { Rng } from './rng.js';
import {
  HEALTH_POTION_TIERS,
  MANA_POTION_TIERS,
  SPIRIT_POTION_TIERS,
  potionById,
} from './supplies.js';
import type { CharacterState, EquipSlot } from './types.js';

/** Crystal market category ids used by the client Cyclopedia. */
export const ITEM_MARKET_CATEGORIES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: 'Armors' },
  { id: 2, name: 'Amulets' },
  { id: 3, name: 'Boots' },
  { id: 4, name: 'Containers' },
  { id: 24, name: 'Creature Products' },
  { id: 5, name: 'Decoration' },
  { id: 6, name: 'Food' },
  { id: 30, name: 'Gold' },
  { id: 7, name: 'Helmets and Hats' },
  { id: 8, name: 'Legs' },
  { id: 9, name: 'Others' },
  { id: 10, name: 'Potions' },
  { id: 25, name: 'Quivers' },
  { id: 11, name: 'Rings' },
  { id: 12, name: 'Runes' },
  { id: 13, name: 'Shields' },
  { id: 26, name: 'Soul Cores' },
  { id: 14, name: 'Tools' },
  { id: 31, name: 'Unsorted' },
  { id: 15, name: 'Valuables' },
  { id: 16, name: 'Weapons: Ammo' },
  { id: 17, name: 'Weapons: Axe' },
  { id: 18, name: 'Weapons: Clubs' },
  { id: 19, name: 'Weapons: Distance' },
  { id: 20, name: 'Weapons: Swords' },
  { id: 21, name: 'Weapons: Wands' },
];

export function isConsumableItem(item: Item): boolean {
  const type = (item.type ?? '').toLowerCase();
  const name = item.name.toLowerCase();
  if (item.runeSpellName || type.includes('rune')) return true;
  if (type.includes('liquid') || type.includes('potion')) return true;
  if (name.includes('potion') || name.endsWith(' rune')) return true;
  if (potionById(item.id)) return true;
  return false;
}

export function isEquipableItem(item: Item): boolean {
  return slotFor(item) !== null;
}

export type UseItemResult =
  | { ok: true; healed: number; mana: number; message: string }
  | { ok: false; reason: string };

/**
 * Drink a potion from supplies or warehouse. Runes stay on the hunt auto-path;
 * click-use only covers potions mirrored from Crystal potions.lua.
 */
export function useConsumableItem(
  character: CharacterState,
  itemId: number,
  source: 'supply' | 'warehouse',
  rng = new Rng(BigInt(Date.now()) ^ BigInt(itemId)),
): UseItemResult {
  const potion = potionById(itemId);
  if (!potion) {
    const item = itemsById.get(itemId);
    if (item && (item.runeSpellName || (item.type ?? '').toLowerCase().includes('rune'))) {
      return { ok: false, reason: 'Runas são usadas automaticamente na caçada.' };
    }
    return { ok: false, reason: 'Esse item não pode ser usado assim.' };
  }
  if (character.level < potion.level) {
    return { ok: false, reason: `Precisa de level ${potion.level} para beber.` };
  }

  character.supplies ??= [];
  if (source === 'warehouse') character.warehouse ??= [];
  const list = source === 'supply' ? character.supplies : character.warehouse!;
  if (!list.some((stack) => stack.itemId === itemId && stack.count > 0)) {
    return { ok: false, reason: 'Você não tem esse item.' };
  }

  const stats = deriveStats(character);
  const spirit = SPIRIT_POTION_TIERS.find((tier) => tier.itemId === itemId);
  const isHealth = HEALTH_POTION_TIERS.some((tier) => tier.itemId === itemId);
  if (spirit) {
    if (character.health >= stats.maxHealth && character.mana >= stats.maxMana) {
      return { ok: false, reason: 'Você já está com HP e mana cheios.' };
    }
  } else if (isHealth) {
    if (character.health >= stats.maxHealth) {
      return { ok: false, reason: 'Sua vida já está cheia.' };
    }
  } else if (character.mana >= stats.maxMana) {
    return { ok: false, reason: 'Sua mana já está cheia.' };
  }

  if (takeItemStack(list, itemId, 1) < 1) {
    return { ok: false, reason: 'Você não tem esse item.' };
  }

  let healed = 0;
  let mana = 0;

  if (spirit) {
    healed = Math.min(rng.uniform(spirit.min, spirit.max), Math.max(0, stats.maxHealth - character.health));
    mana = Math.min(rng.uniform(spirit.manaMin, spirit.manaMax), Math.max(0, stats.maxMana - character.mana));
  } else if (isHealth) {
    healed = Math.min(rng.uniform(potion.min, potion.max), Math.max(0, stats.maxHealth - character.health));
  } else {
    mana = Math.min(rng.uniform(potion.min, potion.max), Math.max(0, stats.maxMana - character.mana));
  }

  character.health = Math.min(stats.maxHealth, character.health + healed);
  character.mana = Math.min(stats.maxMana, character.mana + mana);

  const bits: string[] = [];
  if (healed > 0) bits.push(`+${healed} HP`);
  if (mana > 0) bits.push(`+${mana} MP`);
  return {
    ok: true,
    healed,
    mana,
    message: bits.length ? `Aaaah... ${bits.join(' · ')}` : 'Aaaah...',
  };
}

export function wornSlotForItem(character: CharacterState, itemId: number): EquipSlot | null {
  for (const [slot, id] of Object.entries(character.equipment)) {
    if (id === itemId) return slot as EquipSlot;
  }
  return null;
}
