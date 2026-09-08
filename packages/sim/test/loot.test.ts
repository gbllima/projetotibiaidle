import { itemsById, itemsByName } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import { advance, isMoneyItem, referenceCharacter, startSession } from '../src/index.js';

describe('loot banking', () => {
  it('banks coin drops directly on the character', () => {
    const character = referenceCharacter(4, 20);
    character.gold = 0;
    character.policy.healthPotionId = -1;
    character.policy.manaPotionId = -1;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.fleeAt = 0;
    const session = startSession(character, 'venore-rotworm-cave', 19n);
    advance(session, 800, { maxEvents: 4000 });

    expect(session.totals.kills).toBeGreaterThan(0);
    expect(session.character.gold).toBeGreaterThan(0);
    expect(session.totals.lootValue).toBeGreaterThan(0);
    const goldCoin = itemsByName.get('gold coin');
    expect(goldCoin).toBeDefined();
    expect(session.totals.lootByItem[goldCoin!.id] ?? 0).toBe(0);
    for (const [id, count] of Object.entries(session.totals.lootByItem)) {
      const item = itemsById.get(Number(id));
      expect(item && isMoneyItem(item)).toBe(false);
      expect(count).toBeGreaterThan(0);
    }
  });
});
