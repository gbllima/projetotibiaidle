import { describe, expect, it } from 'vitest';
import { createCharacter, ROULETTE_SPIN_COST, roulettePool, spinRoulette } from '../src/index.js';
import { Rng } from '../src/rng.js';

describe('roleta', () => {
  it('builds a sorcerer-only pool between levels 80 and 300', () => {
    const pool = roulettePool(1);
    expect(pool.length).toBeGreaterThan(10);
    for (const item of pool) {
      expect(item.vocations.length === 0 || item.vocations.some((v) => v.includes('sorcerer'))).toBe(true);
    }
  });

  it('builds different pools for knight and sorcerer', () => {
    const knight = roulettePool(4);
    const sorcerer = roulettePool(1);
    expect(knight.some((item) => item.name.toLowerCase().includes('wand'))).toBe(false);
    expect(sorcerer.some((item) => item.weaponType === 'wand' || item.type === 'wands')).toBe(true);
  });

  it('charges 75 TC and stores the prize in the depot', () => {
    const character = createCharacter('Mage', 1);
    character.coins = 100;
    character.warehouse = [];
    const result = spinRoulette(character, new Rng(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(character.coins).toBe(100 - ROULETTE_SPIN_COST);
    expect(character.warehouse.some((stack) => stack.itemId === result.itemId)).toBe(true);
  });
});
