import { itemsById, type Item } from '@tibia-idle/data';
import { wearItem } from './equip.js';
import { DEFAULT_BACKPACK_ID, slotFor } from './gear.js';
import { addItemStack, takeItemStack } from './loot.js';
import { SUPPLY_SLOT_DEFAULT } from './progression.js';
import type { CharacterState } from './types.js';

/** Potions, runes, and ammunition — everything else goes to the worn backpack. */
export function isSupplyPouchItem(item: Item): boolean {
  const type = (item.type ?? '').toLowerCase();
  const name = item.name.toLowerCase();
  if (item.runeSpellName || type.includes('rune') || name.endsWith(' rune')) return true;
  if (type.includes('liquid') || type.includes('potion') || name.includes('potion')) return true;
  if (slotFor(item) === 'ammo') return true;
  if (item.weaponType === 'ammo' || item.weaponType === 'ammunition' || item.weaponType === 'missile') {
    return true;
  }
  return false;
}

/** Where a bought stack should land before optional auto-equip. */
export function itemStorageTarget(item: Item): 'supply' | 'backpack' {
  if (isSupplyPouchItem(item)) return 'supply';
  return 'backpack';
}

export function supplySlotCap(character: CharacterState): number {
  return character.supplySlots ?? SUPPLY_SLOT_DEFAULT;
}

/** Whether a new stack can occupy a supply-pouch slot. Existing stacks always grow. */
export function supplyHasRoom(character: CharacterState, itemId: number): boolean {
  character.supplies ??= [];
  if (character.supplies.some((stack) => stack.itemId === itemId)) return true;
  return character.supplies.length < supplySlotCap(character);
}

export type AcquireResult =
  | { equipped: number; stored: number; ok: true }
  | { equipped: number; stored: number; ok: false; reason: string };

/**
 * Add items from a shop, reward, or loot pile.
 * Empty paperdoll slots auto-equip one copy; the rest follow {@link itemStorageTarget}.
 */
export function acquireItemStacks(
  character: CharacterState,
  itemId: number,
  count: number,
  options: { autoEquip?: boolean } = { autoEquip: true },
): AcquireResult {
  const item = itemsById.get(itemId);
  if (!item || count <= 0) return { equipped: 0, stored: 0, ok: true };

  character.warehouse ??= [];
  character.supplies ??= [];
  character.backpackContents ??= [];

  let remaining = count;
  let equipped = 0;
  const slot = slotFor(item);
  const autoEquip = options.autoEquip !== false;

  if (autoEquip && slot && !isSupplyPouchItem(item)) {
    while (remaining > 0 && !character.equipment[slot]) {
      const worn = wearItem(character, itemId);
      if (!worn.ok) break;
      equipped += 1;
      remaining -= 1;
    }
  }

  if (remaining > 0) {
    const target = itemStorageTarget(item);
    if (target === 'supply') {
      if (!supplyHasRoom(character, itemId)) {
        return { equipped, stored: count - remaining, ok: false, reason: 'Supply pouch is full.' };
      }
      addItemStack(character.supplies, itemId, remaining);
    } else {
      const moved = moveStackToBackpack(character, itemId, remaining);
      if (!moved.ok) {
        return { equipped, stored: count - remaining, ok: false, reason: moved.reason };
      }
    }
  }

  return { equipped, stored: remaining, ok: true };
}

/** Paperdoll always has a backpack; pull one from supplies/warehouse if the slot was empty. */
export function ensureBackpackEquipped(character: CharacterState): void {
  if (character.equipment.backpack) return;
  character.warehouse ??= [];
  character.supplies ??= [];

  for (const list of [character.supplies, character.warehouse]) {
    for (const stack of list) {
      const item = itemsById.get(stack.itemId);
      if (!item || slotFor(item) !== 'backpack') continue;
      takeItemStack(list, stack.itemId, 1);
      character.equipment.backpack = stack.itemId;
      return;
    }
  }

  character.equipment.backpack = DEFAULT_BACKPACK_ID;
}

/** Slot capacity of the worn backpack (Crystal containersize, default 20). */
export function backpackCapacity(character: CharacterState): number {
  const id = character.equipment.backpack;
  if (!id) return 20;
  return itemsById.get(id)?.containerSize ?? 20;
}

/** Whether a new stack can occupy a backpack slot. Existing stacks always grow. */
export function backpackHasRoom(character: CharacterState, itemId: number): boolean {
  character.backpackContents ??= [];
  if (character.backpackContents.some((stack) => stack.itemId === itemId)) return true;
  return character.backpackContents.length < backpackCapacity(character);
}

export type MoveStackResult = { ok: true } | { ok: false; reason: string };

export function moveStackToBackpack(
  character: CharacterState,
  itemId: number,
  count: number,
): MoveStackResult {
  if (count <= 0) return { ok: false, reason: 'Invalid count.' };
  if (!backpackHasRoom(character, itemId)) {
    return { ok: false, reason: 'Backpack is full.' };
  }
  character.backpackContents ??= [];
  addItemStack(character.backpackContents, itemId, count);
  return { ok: true };
}

export function moveStackToSupply(
  character: CharacterState,
  itemId: number,
  count: number,
): MoveStackResult {
  if (count <= 0) return { ok: false, reason: 'Invalid count.' };
  if (!supplyHasRoom(character, itemId)) {
    return { ok: false, reason: 'Supply pouch is full.' };
  }
  character.supplies ??= [];
  addItemStack(character.supplies, itemId, count);
  return { ok: true };
}
