import { describe, expect, it } from 'vitest';
import { applyStoreBoost, createCharacter, huntMultipliers } from '../src/index.js';

describe('store gold vs loot boost', () => {
  it('applies loot boost only to loot and gold boost only to gold', () => {
    const now = 1_700_000_000_000;
    const character = createCharacter('BoostTester', 4);
    const base = huntMultipliers(character, 'rat', now);

    applyStoreBoost(character, 'loot_boost', 20, 60_000, now);
    const withLoot = huntMultipliers(character, 'rat', now);
    expect(withLoot.loot).toBeCloseTo(base.loot * 1.2, 5);
    expect(withLoot.gold).toBeCloseTo(base.gold, 5);

    applyStoreBoost(character, 'gold_boost', 50, 60_000, now);
    const withBoth = huntMultipliers(character, 'rat', now);
    expect(withBoth.loot).toBeCloseTo(base.loot * 1.2, 5);
    expect(withBoth.gold).toBeCloseTo(base.gold * 1.5, 5);
    expect(withBoth.loot).not.toBeCloseTo(withBoth.gold, 5);
  });
});
