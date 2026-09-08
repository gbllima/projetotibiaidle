import { itemsById } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import {
  acquireItemStacks,
  backpackCapacity,
  backpackHasRoom,
  createCharacter,
  DEFAULT_BACKPACK_ID,
  ensureBackpackEquipped,
  isSupplyPouchItem,
  itemStorageTarget,
  moveStackToBackpack,
  moveStackToSupply,
  slotFor,
  supplyHasRoom,
  SUPPLY_SLOT_DEFAULT,
  wearItem,
} from '../src/index.js';

describe('acquireItemStacks', () => {
  it('auto-equips a backpack when the paperdoll slot is empty', () => {
    const character = createCharacter('Kina', 4);
    delete character.equipment.backpack;

    const golden = itemsById.get(2871);
    expect(golden?.name).toBe('golden backpack');
    expect(slotFor(golden!)).toBe('backpack');
    expect(itemStorageTarget(golden!)).toBe('backpack');

    const result = acquireItemStacks(character, golden!.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipped).toBe(1);
    expect(result.stored).toBe(0);
    expect(character.equipment.backpack).toBe(golden!.id);
    expect(character.backpackContents.some((stack) => stack.itemId === golden!.id)).toBe(false);
    expect(character.supplies.some((stack) => stack.itemId === golden!.id)).toBe(false);
  });

  it('sends extra backpacks to the worn backpack contents', () => {
    const character = createCharacter('Kina', 4);
    delete character.equipment.backpack;

    const result = acquireItemStacks(character, 2871, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipped).toBe(1);
    expect(result.stored).toBe(1);
    expect(character.equipment.backpack).toBe(2871);
    expect(character.backpackContents.find((stack) => stack.itemId === 2871)?.count).toBe(1);
  });

  it('stores potions in the supply pouch', () => {
    const character = createCharacter('Kina', 4);
    const potion = itemsById.get(266);
    expect(potion?.name).toBe('health potion');
    expect(isSupplyPouchItem(potion!)).toBe(true);
    expect(itemStorageTarget(potion!)).toBe('supply');

    const result = acquireItemStacks(character, potion!.id, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipped).toBe(0);
    expect(result.stored).toBe(5);
    expect(character.supplies.find((stack) => stack.itemId === potion!.id)?.count).toBe(5);
  });

  it('stores bought gear in the backpack when the slot is taken', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    const plate = [...itemsById.values()].find((item) => item.name === 'plate armor');
    const chain = [...itemsById.values()].find((item) => item.name === 'chain armor');
    expect(plate).toBeDefined();
    expect(chain).toBeDefined();
    expect(wearItem(character, plate!.id).ok).toBe(true);

    const result = acquireItemStacks(character, chain!.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(character.equipment.armor).toBe(plate!.id);
    expect(character.backpackContents.some((stack) => stack.itemId === chain!.id)).toBe(true);
  });

  it('sends tools to the backpack, not the supply pouch', () => {
    const rope = itemsById.get(3003);
    expect(rope?.name).toBe('rope');
    expect(isSupplyPouchItem(rope!)).toBe(false);
    expect(itemStorageTarget(rope!)).toBe('backpack');

    const character = createCharacter('Kina', 4);
    const result = acquireItemStacks(character, rope!.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(character.supplies.some((stack) => stack.itemId === rope!.id)).toBe(false);
    expect(character.backpackContents.some((stack) => stack.itemId === rope!.id)).toBe(true);
  });

  it('gives new characters a default backpack and 20 supply slots', () => {
    const character = createCharacter('Kina', 4);
    expect(character.equipment.backpack).toBe(DEFAULT_BACKPACK_ID);
    expect(character.supplySlots).toBe(SUPPLY_SLOT_DEFAULT);
  });

  it('pulls a backpack from supplies when the slot is empty', () => {
    const character = createCharacter('Kina', 4);
    delete character.equipment.backpack;
    character.supplies = [{ itemId: 2871, count: 1 }];

    ensureBackpackEquipped(character);
    expect(character.equipment.backpack).toBe(2871);
    expect(character.supplies.some((stack) => stack.itemId === 2871)).toBe(false);
  });
});

describe('backpack storage', () => {
  it('respects containerSize as distinct stack slots', () => {
    const character = createCharacter('Kina', 4);
    character.backpackContents = [];
    expect(backpackCapacity(character)).toBe(20);
    const ids = [...itemsById.values()].filter((item) => item.id > 0).slice(0, 21).map((item) => item.id);

    for (let i = 0; i < 20; i += 1) {
      expect(backpackHasRoom(character, ids[i]!)).toBe(true);
      expect(moveStackToBackpack(character, ids[i]!, 1).ok).toBe(true);
    }
    expect(backpackHasRoom(character, ids[20]!)).toBe(false);
    expect(moveStackToBackpack(character, ids[20]!, 1).ok).toBe(false);
  });

  it('allows stacking an existing item without using a new slot', () => {
    const character = createCharacter('Kina', 4);
    character.backpackContents = [{ itemId: 3031, count: 1 }];
    expect(backpackHasRoom(character, 3031)).toBe(true);
    expect(moveStackToBackpack(character, 3031, 5).ok).toBe(true);
    expect(character.backpackContents).toEqual([{ itemId: 3031, count: 6 }]);
  });
});

describe('supply pouch slots', () => {
  it('respects supplySlots as distinct stack slots', () => {
    const character = createCharacter('Kina', 4);
    character.supplies = [];
    const ids = [266, 268, 237, 238, 239, 7643, 23375, 7642, 23374, 3155, 3160, 3173, 3198, 3200, 3202, 3203, 3147, 3189, 3190, 3191];
    for (const id of ids) {
      expect(moveStackToSupply(character, id, 1).ok).toBe(true);
    }
    expect(character.supplies.length).toBe(20);
    expect(supplyHasRoom(character, 3192)).toBe(false);
    expect(moveStackToSupply(character, 3192, 1).ok).toBe(false);
  });
});
