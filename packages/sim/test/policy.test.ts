import { describe, expect, it } from 'vitest';
import { chooseSpell, createCharacter, DEFAULT_POLICY, healSpellsFor, hotbarSpells } from '../src/index.js';

describe('spell policy', () => {
  it('picks the highest DPS spell by default', () => {
    const sorcerer = createCharacter('Mage', 1);
    sorcerer.level = 40;
    sorcerer.mana = 9999;
    const spell = chooseSpell(1, 40, 9999, 3);
    expect(spell?.id).toBeTruthy();
  });

  it('honours spell priority over raw DPS', () => {
    const policy = { ...DEFAULT_POLICY, spellPriority: ['energy_strike'] };
    const spell = chooseSpell(1, 40, 9999, 3, policy);
    expect(spell?.id).toBe('energy_strike');
  });

  it('skips disabled spells', () => {
    const policy = { ...DEFAULT_POLICY, disabledSpells: ['energy_strike'], spellPriority: ['energy_strike', 'flame_strike'] };
    const spell = chooseSpell(1, 40, 9999, 1, policy);
    expect(spell?.id).toBe('flame_strike');
  });

  it('gives knights Wound Cleansing by default', () => {
    const knight = createCharacter('Bowen', 4);
    expect(knight.policy.healSpellId).toBe('wound_cleansing');
    expect(healSpellsFor(4, 8).some((spell) => spell.id === 'wound_cleansing')).toBe(true);
  });

  it('lists only enabled priority spells on the hotbar', () => {
    const policy = {
      ...DEFAULT_POLICY,
      spellPriority: ['flame_strike', 'energy_strike', 'fire_wave'],
      disabledSpells: ['energy_strike'],
    };
    const bar = hotbarSpells(1, 40, policy);
    expect(bar.map((spell) => spell.id)).toEqual(['flame_strike', 'fire_wave']);
  });
});
