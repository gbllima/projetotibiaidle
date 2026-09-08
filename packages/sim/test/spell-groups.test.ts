import { describe, expect, it } from 'vitest';
import {
  advance, combatProcs, createCharacter, isSpellGroupReady, SPELLS, startSession, TICK_MS,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

describe('spell group cooldowns', () => {
  it('tracks attack, wave, special and ultimate independently', () => {
    const session = startSession(createCharacter('Mage', 1), HUNT, 1n);
    session.spellCooldowns = { ultimate: 50, wave: 10, special: 0, attack: 0 };
    expect(isSpellGroupReady(session.spellCooldowns, 'attack')).toBe(true);
    expect(isSpellGroupReady(session.spellCooldowns, 'special')).toBe(true);
    expect(isSpellGroupReady(session.spellCooldowns, 'wave')).toBe(false);
    expect(isSpellGroupReady(session.spellCooldowns, 'ultimate')).toBe(false);
  });

  it('casts attack spells while ultimate is recovering', () => {
    const character = createCharacter('Mage', 1);
    character.level = 60;
    character.mana = 5000;
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    character.policy.manaPotionAt = 0;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    // Only one attack strike enabled so rotation is deterministic at high level.
    character.policy.disabledSpells = SPELLS
      .filter((spell) => spell.id !== 'flame_strike')
      .map((spell) => spell.id);

    const session = startSession(character, HUNT, 99n);
    session.startedAt = Date.now();
    session.spellCooldowns = { ultimate: 120 };
    const events = advance(session, 24, { maxEvents: 200 });
    const words = events.filter((event) => event.type === 'player_attack' && event.words).map((event) => event.words);
    expect(words.some((entry) => entry === 'exori flam')).toBe(true);
    expect(session.spellCooldowns?.ultimate).toBeGreaterThan(0);
  });

  it('stops imbuement procs after expiry mid-hunt', () => {
    const character = createCharacter('Kina', 4);
    character.policy.autoAttack = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    const startedAt = Date.now();
    character.imbuements = [{ slot: 'left', type: 'strike', tier: 3, expiresAt: startedAt + TICK_MS * 2 }];

    const session = startSession(character, HUNT, 101n);
    session.startedAt = startedAt;
    expect(combatProcs(character, startedAt).critChance).toBeGreaterThan(0);
    advance(session, 4, { maxEvents: 200 });
    expect(character.imbuements.length).toBe(0);
    expect(combatProcs(character, startedAt + TICK_MS * 4).critChance).toBe(0);
  });
});
