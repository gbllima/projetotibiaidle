import { describe, expect, it } from 'vitest';
import { acquireItemStacks, createCharacter, estimatePackHuntSupplies, packHuntSupplies } from '../src/index.js';

describe('packHuntSupplies', () => {
  it('uses potions already in the supply pouch before buying new ones', () => {
    const character = createCharacter('Buyer', 2);
    character.level = 40;
    character.gold = 50_000;
    character.policy.healthPotionId = 266;
    character.policy.manaPotionId = 268;

    const bought = acquireItemStacks(character, 239, 40);
    expect(bought.ok).toBe(true);
    expect(character.supplies.find((stack) => stack.itemId === 239)?.count).toBe(40);

    const packed = packHuntSupplies(character, 1);
    expect(packed.supplies.some((stack) => stack.itemId === 239 && stack.count === 40)).toBe(true);
    expect(character.supplies.length).toBe(0);
  });

  it('pulls matching stacks from the supply pouch when auto-packing a hunt', () => {
    const character = createCharacter('Buyer', 2);
    character.level = 30;
    character.gold = 10_000;
    character.supplies = [{ itemId: 266, count: 50 }, { itemId: 268, count: 80 }];

    const packed = packHuntSupplies(character, 1);
    expect(packed.supplies.find((stack) => stack.itemId === 266)?.count).toBeGreaterThan(0);
    expect(character.supplies.length).toBe(0);
  });

  it('estimatePackHuntSupplies does not empty the live supply pouch', () => {
    const character = createCharacter('Buyer', 2);
    character.level = 30;
    character.gold = 10_000;
    character.supplies = [{ itemId: 266, count: 50 }, { itemId: 268, count: 80 }];

    const estimate = estimatePackHuntSupplies(character, 1);
    expect(estimate.cost).toBeGreaterThanOrEqual(0);
    expect(character.supplies).toEqual([
      { itemId: 266, count: 50 },
      { itemId: 268, count: 80 },
    ]);
  });
});
