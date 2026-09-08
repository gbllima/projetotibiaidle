import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, deriveStats, SPELLS, startSession, useConsumableItem,
} from '../src/index.js';

describe('potion use', () => {
  it('drinks a mana potion from supplies', () => {
    const character = createCharacter('Mage', 1);
    character.supplies = [{ itemId: 268, count: 3 }];
    character.mana = 5;
    const result = useConsumableItem(character, 268, 'supply');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mana).toBeGreaterThan(0);
      expect(result.healed).toBe(0);
    }
    expect(character.supplies[0]?.count).toBe(2);
    expect(character.mana).toBeGreaterThan(5);
  });

  it('drinks from warehouse when requested', () => {
    const character = createCharacter('Mage', 1);
    character.warehouse = [{ itemId: 266, count: 2 }];
    character.health = 50;
    const stats = deriveStats(character);
    character.health = stats.maxHealth - 200;
    const result = useConsumableItem(character, 266, 'warehouse');
    expect(result.ok).toBe(true);
    expect(character.warehouse[0]?.count).toBe(1);
    expect(character.health).toBeGreaterThan(stats.maxHealth - 200);
  });

  it('rejects when already full', () => {
    const character = createCharacter('Mage', 1);
    character.supplies = [{ itemId: 268, count: 1 }];
    const stats = deriveStats(character);
    character.mana = stats.maxMana;
    const result = useConsumableItem(character, 268, 'supply');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cheia/i);
    expect(character.supplies[0]?.count).toBe(1);
  });

  it('helper drinks mana potions when mana is low', () => {
    const character = createCharacter('Mage', 1);
    character.level = 80;
    character.policy.healthPotionId = -1;
    character.policy.manaPotionId = 0;
    character.policy.manaPotionAt = 0.9;
    character.policy.healSpellId = '';
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.autoAttack = false;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    character.policy.runeId = -1;
    character.supplies = [{ itemId: 238, count: 10 }];
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = Math.floor(stats.maxMana * 0.1);
    const session = startSession(character, 'venore-rotworm-cave', 42n);
    const events = advance(session, 5, { maxEvents: 50, creatureFlee: false });
    expect(events.some((event) => event.type === 'potion' && event.itemId === 238)).toBe(true);
    expect(session.character.mana).toBeGreaterThan(Math.floor(stats.maxMana * 0.1));
  });
});
