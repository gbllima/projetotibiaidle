import { describe, expect, it } from 'vitest';
import { getVocation, stages } from '@tibia-idle/data';
import {
  baseDamageHealing, expForLevel, levelForExp, lootCount, maxWeaponDamage,
  minWeaponDamage, monsterMitigation, reqMana, reqSkillTries, rollLootEntry,
  Rng, stageMultiplier, staminaMultiplier, canReceiveLoot, MAX_LOOT_CHANCE,
} from '../src/index.js';

describe('experience', () => {
  it('matches known Tibia level thresholds', () => {
    expect(expForLevel(1)).toBe(0);
    expect(expForLevel(2)).toBe(100);
    expect(expForLevel(8)).toBe(4200);
    expect(expForLevel(20)).toBe(98800);
    expect(expForLevel(100)).toBe(15694800);
  });

  it('grows monotonically', () => {
    for (let level = 2; level < 400; level += 1) {
      expect(expForLevel(level)).toBeGreaterThan(expForLevel(level - 1));
    }
  });

  it('inverts cleanly', () => {
    for (const level of [8, 20, 57, 100, 250, 500]) {
      expect(levelForExp(expForLevel(level))).toBe(level);
      expect(levelForExp(expForLevel(level) - 1)).toBe(level - 1);
    }
    expect(levelForExp(0)).toBe(1);
  });
});

describe('damage', () => {
  it('computes the spell level bonus', () => {
    expect(baseDamageHealing(8)).toBe(baseDamageHealing(8));
    expect(baseDamageHealing(100)).toBeGreaterThan(baseDamageHealing(50));
    expect(baseDamageHealing(1000)).toBeGreaterThan(baseDamageHealing(500));
  });

  it('scales weapon damage with skill and attack', () => {
    const low = maxWeaponDamage(100, 60, 40, 1.2, true);
    const highSkill = maxWeaponDamage(100, 120, 40, 1.2, true);
    const highAttack = maxWeaponDamage(100, 60, 80, 1.2, true);
    expect(highSkill).toBeGreaterThan(low);
    expect(highAttack).toBeGreaterThan(low);
    expect(low).toBe(Math.round(0.085 * 1.2 * 40 * 60 + 20));
  });

  it('gives distance a higher coefficient than melee', () => {
    expect(maxWeaponDamage(100, 90, 50, 1.2, false)).toBeGreaterThan(
      maxWeaponDamage(100, 90, 50, 1.2, true),
    );
  });

  it('uses integer division for the level term', () => {
    expect(minWeaponDamage(104, 10)).toBe(20);
    expect(minWeaponDamage(100, 10)).toBe(20);
    expect(minWeaponDamage(105, 10)).toBe(21);
  });

  it('returns nothing for a character with no weapon', () => {
    expect(maxWeaponDamage(100, 90, 0, 1.2, true)).toBe(0);
    expect(minWeaponDamage(100, 0)).toBe(0);
  });

  it('caps monster mitigation at 45 percent', () => {
    expect(monsterMitigation(0.07)).toBeCloseTo(0.105);
    expect(monsterMitigation(100)).toBe(45);
  });
});

describe('advancement', () => {
  it('needs no tries at or below the starting skill', () => {
    expect(reqSkillTries(2, 10, 1.1)).toBe(0);
  });

  it('grows skill cost exponentially', () => {
    const knight = getVocation(4);
    const first = reqSkillTries(2, 11, knight.skillMultipliers.sword);
    const later = reqSkillTries(2, 60, knight.skillMultipliers.sword);
    expect(later).toBeGreaterThan(first * 100);
  });

  it('matches the magic level cost formula', () => {
    const sorcerer = getVocation(1);
    expect(reqMana(1, sorcerer.manaMultiplier)).toBe(1600);
    expect(reqMana(2, sorcerer.manaMultiplier)).toBe(Math.floor(1600 * sorcerer.manaMultiplier));
    expect(reqMana(0, sorcerer.manaMultiplier)).toBe(0);
  });

  it('applies the configured experience stages', () => {
    expect(stageMultiplier(stages.experience, 5)).toBe(7);
    expect(stageMultiplier(stages.experience, 25)).toBe(5);
    expect(stageMultiplier(stages.experience, 500)).toBe(2);
  });
});

describe('stamina', () => {
  it('rewards a rested premium character', () => {
    expect(staminaMultiplier(2400, true)).toBe(1.5);
    expect(staminaMultiplier(2400, false)).toBe(1);
    expect(staminaMultiplier(1000, false)).toBe(1);
    expect(staminaMultiplier(500, false)).toBe(0.5);
    expect(staminaMultiplier(0, false)).toBe(0);
  });

  it('keeps loot enabled while any stamina remains', () => {
    expect(canReceiveLoot(841)).toBe(true);
    expect(canReceiveLoot(840)).toBe(true);
    expect(canReceiveLoot(1)).toBe(true);
    expect(canReceiveLoot(0)).toBe(false);
  });
});

describe('loot', () => {
  it('drops a guaranteed entry every time', () => {
    const rng = new Rng(1n);
    for (let i = 0; i < 200; i += 1) {
      expect(rollLootEntry(MAX_LOOT_CHANCE, 1, 1, rng)).not.toBeNull();
    }
  });

  it('never drops a zero-chance entry', () => {
    const rng = new Rng(2n);
    for (let i = 0; i < 200; i += 1) {
      expect(rollLootEntry(0, 1, 1, rng)).toBeNull();
    }
  });

  it('hits roughly the stated frequency', () => {
    const rng = new Rng(3n);
    let drops = 0;
    for (let i = 0; i < 20000; i += 1) {
      if (rollLootEntry(10000, 1, 1, rng) !== null) drops += 1;
    }
    expect(drops).toBeGreaterThan(1700);
    expect(drops).toBeLessThan(2300);
  });

  it('scales with the loot rate', () => {
    const at1 = new Rng(4n);
    const at5 = new Rng(4n);
    let low = 0;
    let high = 0;
    for (let i = 0; i < 20000; i += 1) {
      if (rollLootEntry(1000, 1, 1, at1) !== null) low += 1;
      if (rollLootEntry(1000, 5, 1, at5) !== null) high += 1;
    }
    expect(high).toBeGreaterThan(low * 3);
  });

  it('keeps stack sizes inside the declared bounds', () => {
    for (const roll of [0, 1, 999, 54321, 99999]) {
      const count = lootCount(roll, 1, 100);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(100);
    }
    expect(lootCount(500, 1, 1)).toBe(1);
  });
});
