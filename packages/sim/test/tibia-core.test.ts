import { describe, expect, it } from 'vitest';
import { getVocation, recommendedLevelFor } from '@tibia-idle/data';
import {
  advance, applyCondition, BOOSTED_EXPERIENCE, BOOSTED_LOOT, createCharacter, dailyBoostedMonster,
  deriveStats, describeSession, huntMultipliers, isPromoted, PROMOTION_GOLD,
  PROMOTION_LEVEL, promoteCharacter, startSession, TICK_MS,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

function ready(character: ReturnType<typeof createCharacter>): ReturnType<typeof createCharacter> {
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = Math.max(character.mana, stats.maxMana);
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  return character;
}

describe('promotion, souls, utamo, cure and boosted creature', () => {
  it('promotes a knight to elite knight and keeps hunt levels', () => {
    const character = createCharacter('Kina', 4);
    character.level = PROMOTION_LEVEL;
    character.gold = PROMOTION_GOLD;
    const result = promoteCharacter(character);
    expect(result.ok).toBe(true);
    expect(character.vocationId).toBe(8);
    expect(isPromoted(8)).toBe(true);
    expect(character.gold).toBe(0);
    expect(recommendedLevelFor(HUNT, 8)).not.toBeNull();
    expect(recommendedLevelFor(HUNT, 8)).toBe(recommendedLevelFor(HUNT, 4));
  });

  it('maps exalted monk hunts through the monk table, not sorcerer baseId', () => {
    const monk = recommendedLevelFor(HUNT, 9);
    const exalted = recommendedLevelFor(HUNT, 10);
    const sorcerer = recommendedLevelFor(HUNT, 1);
    expect(monk).not.toBeNull();
    expect(exalted).toBe(monk);
    if (sorcerer !== null && monk !== null && sorcerer !== monk) {
      expect(exalted).not.toBe(sorcerer);
    }
  });

  it('refuses promotion below level 20', () => {
    const character = createCharacter('Kina', 4);
    character.level = 19;
    character.gold = PROMOTION_GOLD;
    const result = promoteCharacter(character);
    expect(result.ok).toBe(false);
    expect(character.vocationId).toBe(4);
  });

  it('recasts utamo vita on a mage with the shield policy', () => {
    const character = ready(createCharacter('Mage', 1));
    character.level = 20;
    ready(character);
    character.mana = 400;
    const stats = deriveStats(character);
    character.health = Math.floor(stats.maxHealth * 0.3);
    character.policy.magicShield = true;
    character.policy.magicShieldAt = 0.4;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.manaPotionAt = 0;
    const session = startSession(character, HUNT, 3n);
    expect(session.boostedMonsterId).toBeUndefined();
    const events = advance(session, 4, { maxEvents: 80 });
    expect(events.some((event) => event.type === 'buff' && event.words === 'utamo vita')).toBe(true);
    expect(session.magicShieldTicks).toBeGreaterThan(0);
    expect(session.character.mana).toBeLessThan(400);
    expect(describeSession(session)?.utamo).toBe(true);
  });

  it('cures poison with exana pox and spends mana', () => {
    const character = ready(createCharacter('Kina', 4));
    character.level = 20;
    ready(character);
    character.mana = 200;
    character.policy.cure = true;
    character.policy.haste = false;
    character.policy.food = false;
    const session = startSession(character, HUNT, 5n);
    applyCondition(session, 'COMBAT_EARTHDAMAGE', 80);
    expect(session.conditions.some((entry) => entry.id === 'poison')).toBe(true);
    const events = advance(session, 2, { maxEvents: 80 });
    expect(events.some((event) => event.type === 'buff' && event.words === 'exana pox')).toBe(true);
    expect(session.conditions.some((entry) => entry.id === 'poison')).toBe(false);
    expect(session.character.mana).toBeLessThan(200);
  });

  it('regenerates soul while hunting on a promoted knight', () => {
    const character = createCharacter('Kina', 4);
    character.level = PROMOTION_LEVEL;
    character.gold = PROMOTION_GOLD;
    promoteCharacter(character);
    ready(character);
    character.soul = 0;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    const vocation = getVocation(character.vocationId);
    expect(vocation.soulMax).toBe(200);
    const ticks = Math.ceil(vocation.gainSoulTicks / TICK_MS) + 2;
    const session = startSession(character, HUNT, 7n);
    advance(session, ticks, { maxEvents: 400 });
    expect(session.character.soul).toBeGreaterThanOrEqual(1);
    expect(describeSession(session)?.soulMax).toBe(200);
  });

  it('keeps the daily boosted creature stable for a UTC day and boosts that species', () => {
    const noon = Date.UTC(2026, 7, 19, 12, 0, 0);
    const later = Date.UTC(2026, 7, 19, 23, 59, 0);
    const first = dailyBoostedMonster(noon);
    const sameDay = dailyBoostedMonster(later);
    expect(first).toBeTruthy();
    expect(sameDay?.id).toBe(first?.id);
    const character = createCharacter('Kina', 4);
    const plain = huntMultipliers(character, first!.id, 0, []);
    const boosted = huntMultipliers(character, first!.id, 0, [], first!.id);
    expect(boosted.experience).toBeCloseTo(plain.experience * BOOSTED_EXPERIENCE, 8);
    expect(boosted.loot).toBeCloseTo(plain.loot * BOOSTED_LOOT, 8);
    expect(startSession(character, HUNT, 1n).boostedMonsterId).toBeUndefined();
  });
});
