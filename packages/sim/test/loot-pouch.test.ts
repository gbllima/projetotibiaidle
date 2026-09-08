import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, defaultSupplies, deriveStats, describeSession,
  carriedWeight, startSession,
} from '../src/index.js';

describe('loot pouch', () => {
  it('fills the pouch for a mage even when the supply pack is overweight', () => {
    const character = createCharacter('Mage', 1);
    character.level = 40;
    character.magicLevel = 20;
    character.gold = 200_000;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.lootMinValue = 0;
    character.supplies = defaultSupplies(character, 1);
    // Casters' default mana packs often exceed capacity — that used to empty the pouch.
    expect(carriedWeight(character, {})).toBeGreaterThan(deriveStats(character).capacity);

    const session = startSession(character, 'venore-rotworm-cave', 11n);
    advance(session, 700, { maxEvents: 4000 });
    expect(session.totals.kills).toBeGreaterThan(0);
    expect(Object.keys(session.totals.lootByItem).length).toBeGreaterThan(0);
    expect(describeSession(session)?.loot.length).toBeGreaterThan(0);
  });
});
