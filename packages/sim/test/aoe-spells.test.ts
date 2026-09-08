import { describe, expect, it } from 'vitest';
import {
  advance, baseDamageHealing, createCharacter, deriveStats,
  SPELLS, spellDamage, spellSkillDamage, startSession,
} from '../src/index.js';

describe('weapon / AOE spell formulas', () => {
  it('matches Crystal spellSkillDamage for berserk (exori)', () => {
    const berserk = SPELLS.find((spell) => spell.id === 'berserk')!;
    const level = 50;
    const skill = 70;
    const attack = 42;
    const avg = spellSkillDamage(44, level, skill, attack);
    expect(avg).toBeCloseTo(
      baseDamageHealing(level) + (44 / 1000) * skill * attack + 44 / 6,
      5,
    );
    const range = spellDamage(
      berserk,
      level,
      10,
      baseDamageHealing,
      undefined,
      { attackSkill: skill, weaponDamage: attack },
    );
    expect(range.min).toBe(Math.floor(avg * 0.9));
    expect(range.max).toBe(Math.ceil(avg * 1.1));
    expect(range.min).toBeGreaterThan(50);
  });

  it('lands exori damage on dragons for a geared knight', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    character.skills.sword = { level: 65, tries: 0 };
    character.equipment.left = 3271; // spike sword atk 24
    character.mana = 2000;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    character.policy.manaPotionAt = 0;
    character.policy.disabledSpells = SPELLS
      .filter((spell) => spell.id !== 'berserk')
      .map((spell) => spell.id);
    const stats = deriveStats(character);
    character.health = stats.maxHealth;

    const session = startSession(character, 'darashia-dragon-lair', 11n);
    const events = advance(session, 16, { maxEvents: 400 });
    const cast = events.find((event) => event.type === 'player_attack' && event.words === 'exori');
    expect(cast?.area).toBe(true);
    expect(cast?.effect).toBe('CONST_ME_HITAREA');
    expect(cast?.shoot).toBeUndefined();

    const exoriHits = events.filter(
      (event) => event.type === 'player_attack' && event.uid !== undefined && !event.words && event.area,
    );
    expect(exoriHits.length).toBeGreaterThanOrEqual(2);
    expect(exoriHits.every((event) => !event.shoot)).toBe(true);
    expect(exoriHits.some((event) => (event.amount ?? 0) > 0)).toBe(true);
  });

  it('fires sorcerer / monk / paladin area spells for damage', () => {
    const cases: Array<{ vocation: number; hunt: string; spellId: string; words: string; level: number }> = [
      { vocation: 1, hunt: 'venore-rotworm-cave', spellId: 'fire_wave', words: 'exevo flam hur', level: 25 },
      { vocation: 9, hunt: 'venore-rotworm-cave', spellId: 'flurry_of_blows', words: 'exori mas pug', level: 40 },
      { vocation: 3, hunt: 'venore-rotworm-cave', spellId: 'divine_caldera', words: 'exevo mas san', level: 55 },
    ];
    for (const entry of cases) {
      const character = createCharacter('Tester', entry.vocation);
      character.level = entry.level;
      character.magicLevel = Math.max(20, Math.floor(entry.level / 2));
      character.mana = 5000;
      character.skills.fist = { level: 60, tries: 0 };
      character.skills.distance = { level: 70, tries: 0 };
      character.policy.fleeAt = 0;
      character.policy.stopWhenOutOfSupplies = false;
      character.policy.healthPotionAt = 0;
      character.policy.manaPotionAt = 0;
      character.policy.runeId = -1;
      character.policy.disabledSpells = SPELLS
        .filter((spell) => spell.id !== entry.spellId)
        .map((spell) => spell.id);
      const stats = deriveStats(character);
      character.health = stats.maxHealth;
      const session = startSession(character, entry.hunt, BigInt(entry.level * 3));
      const events = advance(session, 24, { maxEvents: 500 });
      expect(
        events.some((event) => event.type === 'player_attack' && event.words === entry.words),
        `${entry.words} should cast`,
      ).toBe(true);
      expect(
        events.some((event) => (
          event.type === 'player_attack'
          && Boolean(event.uid)
          && (event.amount ?? 0) > 0
        )),
        `${entry.words} should deal damage`,
      ).toBe(true);
    }
  });
});
