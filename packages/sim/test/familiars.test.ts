import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, familiarFor, FAMILIARS, SPELLS, startSession,
} from '../src/index.js';

describe('vocation familiars', () => {
  it('maps every base vocation to a Crystal familiar', () => {
    expect(FAMILIARS).toHaveLength(5);
    expect(familiarFor(1)?.name).toBe('Thundergiant');
    expect(familiarFor(4)?.words).toBe('utevo gran res eq');
    expect(familiarFor(9)?.lookType).toBe(1818);
    expect(familiarFor(10)?.name).toBe('Omniphant');
  });

  it('summons Skullfrost for a high-level knight', () => {
    const character = createCharacter('Kina', 4);
    character.level = 200;
    character.mana = 5000;
    character.policy.autoAttack = false;
    character.policy.familiar = true;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.healthPotionAt = 0;
    character.policy.manaPotionAt = 0;
    character.policy.healSpellAt = 0;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    const before = character.mana;
    const session = startSession(character, 'venore-rotworm-cave', 44n);
    const events = advance(session, 4, { maxEvents: 80, creatureFlee: false });
    expect(events.some((event) => event.type === 'buff' && event.words === 'utevo gran res eq')).toBe(true);
    expect(session.summons?.some((entry) => entry.name === 'Skullfrost' && entry.familiar)).toBe(true);
    expect(character.mana).toBe(before - 1000);
  });
});
