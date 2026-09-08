import { describe, expect, it } from 'vitest';
import { monstersById } from '@tibia-idle/data';
import {
  bossPoints, bossSlotCap, bossStage, bossStagePoints, calculateBosstiaryLootBonus,
  createCharacter, huntMultipliers, proficiencyMultiplier, setWorldEvent,
  wheelBonus, wheelPointsEarned, wheelPointsLeft, WHEEL_UNLOCK_LEVEL,
} from '../src/index.js';

describe('endgame', () => {
  it('gives no wheel points before unlock', () => {
    expect(wheelPointsEarned(8)).toBe(0);
    expect(wheelPointsEarned(WHEEL_UNLOCK_LEVEL)).toBe(0);
    expect(wheelPointsEarned(60)).toBe(10);
  });

  it('applies wheel ranks to combat multipliers', () => {
    setWorldEvent(null);
    const character = createCharacter('Wheeler', 4);
    character.level = 60;
    character.wheel = { combat: 5, fortune: 2 };
    expect(wheelPointsLeft(character)).toBe(3);
    const bonus = wheelBonus(character);
    expect(bonus.damage).toBeCloseTo(0.06);
    expect(bonus.loot).toBeCloseTo(0.024);
    const multi = huntMultipliers(character, 'dragon');
    expect(multi.damage).toBeGreaterThan(1.05);
    expect(multi.loot).toBeGreaterThan(1.02);
  });

  it('uses Crystal bosstiary stages for points and slots', () => {
    expect(bossStage(24, 'bane')).toBe(0);
    expect(bossStage(25, 'bane')).toBe(1);
    expect(bossStage(300, 'bane')).toBe(3);
    expect(bossStagePoints(300, 'bane')).toBe(50);
    expect(bossStage(5, 'nemesis')).toBe(3);
    expect(bossStagePoints(5, 'nemesis')).toBe(100);

    expect(calculateBosstiaryLootBonus(0)).toBe(25);
    expect(calculateBosstiaryLootBonus(250)).toBe(50);
    expect(calculateBosstiaryLootBonus(251)).toBe(49);
    expect(calculateBosstiaryLootBonus(1250)).toBe(100);

    const bane = [...monstersById.values()].find((m) => m.bosstiaryRace === 'bane');
    expect(bane).toBeTruthy();
    expect(bossPoints({ [bane!.id]: 25 })).toBe(5);
    expect(bossSlotCap({ [bane!.id]: 24 })).toBe(0);
    expect(bossSlotCap({ [bane!.id]: 25 })).toBe(1);
  });

  it('applies slotted boss loot bonus without XP bonus', () => {
    const boss = [...monstersById.values()].find((m) => m.bosstiaryRace === 'bane');
    expect(boss).toBeTruthy();
    const character = createCharacter('Hunter', 4);
    character.bosstiary = { [boss!.id]: 300 };
    character.bossSlots = [boss!.id];
    setWorldEvent({ name: 'Double', experience: 2, loot: 1.5 });
    const slotted = huntMultipliers(character, boss!.id);
    const other = huntMultipliers(character, 'rat');
    expect(slotted.experience).toBeCloseTo(other.experience);
    expect(slotted.loot).toBeGreaterThan(other.loot);
    expect(other.experience).toBeGreaterThan(1.9);
    // mastery bane = 50 pts → loot bonus 30% + mastery 25% = 55% on top of world loot
    expect(slotted.loot / other.loot).toBeCloseTo(1.55, 5);
    setWorldEvent(null);
  });

  it('applies the daily XP boost while it lasts', () => {
    const character = createCharacter('Boosted', 4);
    const now = 1_000_000;
    character.xpBoostUntil = now + 60_000;
    const multi = huntMultipliers(character, 'rat', now);
    expect(multi.experience).toBeGreaterThan(1.09);
  });

  it('caps weapon proficiency at +10%', () => {
    const character = createCharacter('Pro', 4);
    character.skills.sword = { level: 200, tries: 0 };
    expect(proficiencyMultiplier(character)).toBeCloseTo(1.1);
  });
});
