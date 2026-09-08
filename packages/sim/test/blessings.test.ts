import { describe, expect, it } from 'vitest';
import {
  applyDeathPenalty, blessingCost, blessingCount, BLESSING_BITS, createCharacter,
  expForLevel, hasBlessing, normalizeBlessingMask,
} from '../src/index.js';

describe('blessings', () => {
  it('uses Tibia Global temple prices', () => {
    expect(blessingCost(8)).toBe(2000);
    expect(blessingCost(50)).toBe(200 * (50 - 20));
    expect(blessingCost(130)).toBe(20_000 + 75 * (130 - 120));
  });

  it('tracks individual blessings with a bitmask', () => {
    const mask = BLESSING_BITS[0]! | BLESSING_BITS[2]!;
    expect(blessingCount(mask)).toBe(2);
    expect(hasBlessing(mask, 0)).toBe(true);
    expect(hasBlessing(mask, 1)).toBe(false);
    expect(normalizeBlessingMask(BLESSING_BITS[0]! | BLESSING_BITS[1]!)).toBe(BLESSING_BITS[0]! | BLESSING_BITS[1]!);
  });

  it('loses less experience with five blessings and then consumes them', () => {
    const naked = createCharacter('Naked', 4);
    naked.experience = expForLevel(8) + 8_000;
    const blessed = createCharacter('Blessed', 4);
    blessed.experience = expForLevel(8) + 8_000;
    blessed.blessings = BLESSING_BITS.reduce((m, b) => m | b, 0);

    const raw = applyDeathPenalty(naked);
    const shielded = applyDeathPenalty(blessed);

    expect(raw.lost).toBeGreaterThan(shielded.lost);
    expect(shielded.blessingsUsed).toBe(5);
    expect(blessed.blessings).toBe(0);
    expect(naked.level).toBe(8);
    expect(blessed.level).toBe(8);
    expect(naked.experience).toBeGreaterThanOrEqual(expForLevel(8));
  });

  it('reduces skill loss when blessings are active', () => {
    const naked = createCharacter('Naked', 4);
    naked.level = 30;
    naked.experience = expForLevel(30) + 50_000;
    naked.skills.sword = { level: 95, tries: 12_000 };
    naked.magicLevel = 55;
    naked.manaSpent = 4000;

    const blessed = createCharacter('Blessed', 4);
    blessed.level = 30;
    blessed.experience = expForLevel(30) + 50_000;
    blessed.skills.sword = { level: 95, tries: 12_000 };
    blessed.magicLevel = 55;
    blessed.manaSpent = 4000;
    blessed.blessings = BLESSING_BITS.reduce((m, b) => m | b, 0);

    applyDeathPenalty(naked);
    applyDeathPenalty(blessed);

    expect(naked.skills.sword.level).toBeLessThan(95);
    expect(blessed.skills.sword.level).toBeGreaterThan(naked.skills.sword.level);
  });
});
