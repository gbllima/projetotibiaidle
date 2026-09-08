import { describe, expect, it } from 'vitest';
import {
  advance, applyCondition, ATTACK_RUNES, chooseRune, createCharacter, defaultSupplies,
  describeSession, formatCombatLog, hasteSpellFor, SPELLS, startSession, suppliesCost,
} from '../src/index.js';

const HUNT = 'elf-cave-ab-dendriel';

function mage(level = 45): ReturnType<typeof createCharacter> {
  const character = createCharacter('Mage', 1);
  character.level = level;
  character.magicLevel = Math.max(15, Math.floor(level / 3));
  character.mana = 9999;
  character.policy.autoAttack = false;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  character.policy.fleeAt = 0;
  character.policy.haste = false;
  character.policy.food = false;
  character.policy.runeId = -1;
  return character;
}

describe('idle Tibia support, runes, conditions and capacity', () => {
  it('recasts utani hur and spends mana', () => {
    const character = createCharacter('Kina', 4);
    character.level = 20;
    character.mana = 200;
    character.policy.haste = true;
    character.policy.food = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    const haste = hasteSpellFor(character);
    expect(haste?.words).toBe('utani hur');
    const session = startSession(character, HUNT, 3n);
    const events = advance(session, 4, { maxEvents: 200 });
    expect(events.some((event) => event.type === 'buff' && event.words === 'utani hur')).toBe(true);
    expect(session.hasteTicks).toBeGreaterThan(0);
    expect(session.character.mana).toBeLessThan(200);
  });

  it('casts utani gran hur on a high-level sorcerer', () => {
    const character = mage(40);
    character.policy.haste = true;
    expect(hasteSpellFor(character)?.words).toBe('utani gran hur');
    const session = startSession(character, HUNT, 5n);
    advance(session, 4, { maxEvents: 80 });
    expect(session.hasteTicks).toBeGreaterThan(0);
  });

  it('eats brown mushrooms and stays fed', () => {
    const character = mage(20);
    character.policy.food = true;
    character.supplies = [{ itemId: 3725, count: 5 }];
    const session = startSession(character, HUNT, 7n);
    const events = advance(session, 4, { maxEvents: 80 });
    expect(events.some((event) => event.type === 'buff' && event.itemId === 3725)).toBe(true);
    expect(session.foodTicks).toBeGreaterThan(0);
    expect(character.supplies[0]!.count).toBe(4);
  });

  it('throws sudden death on the attack group and consumes a charge', () => {
    const character = mage(50);
    character.policy.runeId = 3155;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    character.supplies = [{ itemId: 3155, count: 20 }];
    const session = startSession(character, 'venore-rotworm-cave', 11n);
    const events = advance(session, 24, { maxEvents: 400 });
    const runeHit = events.find((event) => (
      event.type === 'player_attack'
      && event.itemId === 3155
      && Boolean(event.uid)
      && event.shoot === 'CONST_ANI_SUDDENDEATH'
    ));
    expect(runeHit).toBeTruthy();
    expect(runeHit?.damageType).toBe('COMBAT_DEATHDAMAGE');
    expect((runeHit?.amount ?? 0) + (runeHit?.blocked ? 1 : 0)).toBeGreaterThan(0);
    expect(character.supplies[0]!.count).toBeLessThan(20);
  });

  it('does not pick a rune when the helper has runes off', () => {
    const character = mage(50);
    character.supplies = [{ itemId: 3155, count: 20 }];
    expect(chooseRune(character, character.policy, 3)).toBeNull();
  });

  it('ticks poison after an earth combat hit', () => {
    const character = createCharacter('Kina', 4);
    character.policy.food = false;
    character.policy.haste = false;
    character.policy.cure = false;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    const session = startSession(character, HUNT, 13n);
    applyCondition(session, 'COMBAT_EARTHDAMAGE', 80);
    expect(session.conditions.some((entry) => entry.id === 'poison')).toBe(true);
    const before = session.character.health;
    const events = advance(session, 20, { maxEvents: 200 });
    expect(events.some((event) => event.type === 'condition' && event.skill === 'poison')).toBe(true);
    expect(session.character.health).toBeLessThan(before);
    const log = formatCombatLog(events.filter((event) => event.type === 'condition'), 'pt');
    expect(log.some((line) => line.text.includes('poison'))).toBe(true);
  });

  it('packs food but not runes in the default supply bag', () => {
    const character = mage(40);
    character.policy.food = true;
    character.policy.runeId = -1;
    const supplies = defaultSupplies(character, 1);
    expect(supplies.some((stack) => stack.itemId === 3725)).toBe(true);
    expect(supplies.some((stack) => ATTACK_RUNES.some((rune) => rune.itemId === stack.itemId))).toBe(false);
    character.policy.runeId = 0;
    const withRunes = defaultSupplies(character, 1);
    expect(withRunes.some((stack) => ATTACK_RUNES.some((rune) => rune.itemId === stack.itemId))).toBe(true);
    expect(suppliesCost(withRunes)).toBeGreaterThan(suppliesCost(supplies));
  });

  it('reports haste, pack remaining and capacity on the session snapshot', () => {
    const character = mage(40);
    character.policy.haste = true;
    character.policy.food = true;
    character.supplies = [{ itemId: 3725, count: 3 }];
    const session = startSession(character, HUNT, 23n);
    advance(session, 8, { maxEvents: 80 });
    const view = describeSession(session);
    expect(view?.haste).toBe(true);
    expect(view?.fed).toBe(true);
    expect(view?.packSize).toBeGreaterThan(0);
    expect(view?.packAlive).toBeGreaterThan(0);
    expect(view?.capacityMax).toBeGreaterThan(view?.capacityUsed ?? 0);
  });
});
