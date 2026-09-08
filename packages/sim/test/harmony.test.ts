import { describe, expect, it } from 'vitest';
import {
  advance, addHarmony, charmFatalHold, createCharacter, deriveStats, harmonyBonusPercent,
  harmonyDamageMultiplier, SPELLS, spendHarmony, startSession,
} from '../src/index.js';
import { charms } from '@tibia-idle/data';
import { Rng } from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

describe('monk harmony', () => {
  it('stacks double the Crystal spender bonus', () => {
    expect(harmonyBonusPercent(1)).toBe(7);
    expect(harmonyBonusPercent(2)).toBe(14);
    expect(harmonyBonusPercent(5)).toBe(112);
    expect(harmonyDamageMultiplier(5)).toBeCloseTo(2.12, 5);
    expect(harmonyBonusPercent(1, true)).toBe(10);
  });

  it('builds on Swift Jab and spends on Tiger Clash', () => {
    const character = createCharacter('Monk', 9);
    character.level = 40;
    character.skills.fist.level = 40;
    character.mana = 2000;
    character.harmony = 0;
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.virtueHarmony = false;
    character.policy.focusHarmony = false;
    character.policy.familiar = false;
    character.policy.disabledSpells = SPELLS
      .filter((spell) => spell.id !== 'swift_jab' && spell.id !== 'tiger_clash')
      .map((spell) => spell.id);
    character.policy.spellPriority = ['swift_jab', 'tiger_clash'];

    const session = startSession(character, HUNT, 21n);
    session.startedAt = Date.now();
    const events = advance(session, 80, { maxEvents: 400, creatureFlee: false });
    expect(events.some((event) => event.type === 'player_attack' && event.words === 'exori infir pug')).toBe(true);
    expect(session.totals.damageDealt).toBeGreaterThan(0);
    // Spender needs stacks; after builders fire, Tiger Clash should appear.
    expect(events.some((event) => event.type === 'player_attack' && event.words === 'exori infir nia')).toBe(true);
  });

  it('Virtue of Harmony keeps a floor of 1 after spend', () => {
    expect(spendHarmony(true)).toBe(1);
    expect(spendHarmony(false)).toBe(0);
    expect(addHarmony(5, 1, false)).toBe(5);
  });

  it('recasts utori virtu for monks', () => {
    const character = createCharacter('Monk', 9);
    character.level = 25;
    const stats = deriveStats(character);
    character.mana = stats.maxMana;
    character.virtueHarmony = false;
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.virtueHarmony = true;
    character.policy.focusHarmony = false;
    character.policy.familiar = false;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);

    const session = startSession(character, HUNT, 22n);
    const events = advance(session, 4, { maxEvents: 80 });
    expect(events.some((event) => event.type === 'buff' && event.words === 'utori virtu')).toBe(true);
    expect(session.character.virtueHarmony).toBe(true);
    expect(session.character.harmony).toBeGreaterThanOrEqual(1);
  });
});

describe('fatal hold', () => {
  it('can proc on a bound species', () => {
    const hold = charms.find((charm) => charm.name === 'Fatal Hold')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: hold.id, monsterId: 'rotworm' }];
    let hit = false;
    for (let seed = 1; seed <= 40; seed += 1) {
      if (charmFatalHold(character, 'rotworm', new Rng(seed))) hit = true;
    }
    expect(hit).toBe(true);
  });
});
