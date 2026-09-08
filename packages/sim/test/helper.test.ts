import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, deriveStats, huntThroughput, SPELLS, startSession,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

function huntSession(vocationId: number, patch: Record<string, unknown> = {}) {
  const character = createCharacter('Helper', vocationId);
  character.level = 80;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.fleeAt = 0;
  character.policy.haste = false;
  character.policy.food = false;
  character.policy.cure = false;
  character.policy.autoAttack = false;
  character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
  character.policy.runeId = -1;
  character.policy.soulRuneId = -1;
  character.policy.supportRuneId = -1;
  character.policy.familiar = false;
  Object.assign(character.policy, patch);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  character.supplies = [
    { itemId: 7643, count: 50 },
    { itemId: 238, count: 50 },
    { itemId: 7642, count: 20 },
  ];
  return startSession(character, HUNT, 99n);
}

describe('helper automation', () => {
  it('casts exeta res and spawns an extra monster when taunt is on', () => {
    const session = huntSession(4, { taunt: true, healthPotionId: -1, manaPotionId: -1, healSpellId: '' });
    session.active = session.active.slice(0, 1);
    const events = advance(session, 120, { maxEvents: 500, creatureFlee: false });
    expect(events.some((event) => event.type === 'buff' && event.words === 'exeta res')).toBe(true);
    expect(session.active.length).toBeGreaterThan(0);
  });

  it('activates utito tempo when blood rage is enabled', () => {
    const session = huntSession(4, {
      taunt: false,
      bloodRage: true,
      healthPotionId: -1,
      manaPotionId: -1,
      healSpellId: '',
    });
    const events = advance(session, 40, { maxEvents: 200, creatureFlee: false });
    expect(events.some((event) => event.type === 'buff' && event.words === 'utito tempo')).toBe(true);
    expect(session.bloodRageActive).toBe(true);
  });

  it('only casts utamo vita when HP is below the configured threshold', () => {
    const session = huntSession(1, {
      magicShield: true,
      magicShieldAt: 0.5,
      healthPotionId: -1,
      manaPotionId: -1,
      healSpellId: '',
    });
    const stats = deriveStats(session.character);
    session.character.health = stats.maxHealth;
    const full = advance(session, 20, { maxEvents: 100, creatureFlee: false });
    expect(full.some((event) => event.words === 'utamo vita')).toBe(false);

    session.character.health = Math.floor(stats.maxHealth * 0.3);
    session.magicShieldTicks = 0;
    const low = advance(session, 20, { maxEvents: 100, creatureFlee: false });
    expect(low.some((event) => event.words === 'utamo vita')).toBe(true);
  });

  it('uses spirit potion before health potion for paladins', () => {
    const session = huntSession(3, {
      spiritPotionId: 0,
      healthPotionId: 0,
      healthPotionAt: 0.9,
      manaPotionId: -1,
      healSpellId: '',
    });
    const stats = deriveStats(session.character);
    session.character.health = Math.floor(stats.maxHealth * 0.5);
    const events = advance(session, 5, { maxEvents: 80, creatureFlee: false });
    expect(events.some((event) => event.type === 'potion' && event.itemId === 7642)).toBe(true);
  });

  it('uses mana potions when mana drops below the helper threshold', () => {
    const session = huntSession(1, {
      healthPotionId: -1,
      manaPotionId: 0,
      manaPotionAt: 0.9,
      healSpellId: '',
    });
    const stats = deriveStats(session.character);
    session.character.mana = Math.floor(stats.maxMana * 0.1);
    const events = advance(session, 5, { maxEvents: 80, creatureFlee: false });
    expect(events.some((event) => event.type === 'potion' && event.itemId === 238)).toBe(true);
  });
});
