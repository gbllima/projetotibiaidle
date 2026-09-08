import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, deriveStats, SPELLS, spellEffect, spellShoot, startSession,
} from '../src/index.js';

const AREA = SPELLS.filter((spell) => spell.area);

describe('all vocation area attack spells', () => {
  it('every area spell has a visible CONST_ME effect and no missile', () => {
    expect(AREA.length).toBeGreaterThan(8);
    for (const spell of AREA) {
      expect(spellEffect(spell), `${spell.words} needs spellEffect`).toBeTruthy();
      expect(spellShoot(spell), `${spell.words} must not shoot a missile`).toBeUndefined();
    }
  });

  it('deals multi-target damage with area+effect events for each vocation family', () => {
    const cases: Array<{
      vocation: number;
      level: number;
      spellId: string;
      hunt: string;
      skill?: 'sword' | 'fist' | 'distance';
      weapon?: number;
    }> = [
      { vocation: 4, level: 50, spellId: 'berserk', hunt: 'venore-rotworm-cave', skill: 'sword', weapon: 3271 },
      { vocation: 1, level: 30, spellId: 'fire_wave', hunt: 'venore-rotworm-cave' },
      { vocation: 2, level: 45, spellId: 'terra_wave', hunt: 'venore-rotworm-cave' },
      { vocation: 3, level: 55, spellId: 'divine_caldera', hunt: 'venore-rotworm-cave', skill: 'distance' },
      { vocation: 9, level: 40, spellId: 'flurry_of_blows', hunt: 'venore-rotworm-cave', skill: 'fist' },
    ];

    for (const entry of cases) {
      const character = createCharacter('AOE', entry.vocation);
      character.level = entry.level;
      character.magicLevel = Math.max(25, Math.floor(entry.level / 2));
      character.mana = 20_000;
      if (entry.skill) character.skills[entry.skill] = { level: 70, tries: 0 };
      if (entry.weapon) character.equipment.left = entry.weapon;
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

      const session = startSession(character, entry.hunt, BigInt(entry.vocation * 17 + entry.level));
      const events = advance(session, 30, { maxEvents: 800 });
      const spell = SPELLS.find((item) => item.id === entry.spellId)!;
      const cast = events.find((event) => event.type === 'player_attack' && event.words === spell.words);
      expect(cast, `${spell.words} should cast`).toBeTruthy();
      expect(cast?.area).toBe(true);
      expect(cast?.effect).toBe(spellEffect(spell));

      const hits = events.filter(
        (event) => event.type === 'player_attack' && event.uid !== undefined && event.area === true,
      );
      expect(hits.length, `${spell.words} should hit the pack`).toBeGreaterThanOrEqual(2);
      expect(hits.some((event) => (event.amount ?? 0) > 0), `${spell.words} should deal damage`).toBe(true);
      expect(hits.every((event) => !event.shoot)).toBe(true);
      expect(hits.every((event) => !event.effect)).toBe(true);
    }
  });
});
