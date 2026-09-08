import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, deriveStats, SPELLS, startSession,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

describe('soul runes', () => {
  it('soulfire spends soul and applies fire DoT', () => {
    const character = createCharacter('Mage', 1);
    character.level = 40;
    character.magicLevel = 10;
    const stats = deriveStats(character);
    character.mana = stats.maxMana;
    character.soul = 5;
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.soulRuneId = 0;
    character.policy.supportRuneId = -1;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    character.supplies = [{ itemId: 3195, count: 10 }];

    const session = startSession(character, HUNT, 11n);
    session.startedAt = Date.now();
    const events = advance(session, 12, { maxEvents: 200 });
    expect(session.character.soul).toBeLessThan(5);
    expect(events.some((event) => event.type === 'player_attack' && event.itemId === 3195)).toBe(true);
  });

  it('animate dead raises a skeleton summon', () => {
    const character = createCharacter('Mage', 1);
    character.level = 40;
    character.magicLevel = 10;
    character.soul = 5;
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.soulRuneId = -1;
    character.policy.supportRuneId = 0;
    character.supplies = [{ itemId: 3203, count: 5 }];

    const session = startSession(character, HUNT, 13n);
    session.startedAt = Date.now();
    advance(session, 8, { maxEvents: 200 });
    expect(session.summons?.length).toBeGreaterThan(0);
    expect(session.character.soul).toBeLessThan(5);
  });
});
