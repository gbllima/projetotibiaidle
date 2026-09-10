import { describe, expect, it } from 'vitest';
import { calibratedLevelFor, hunts } from '@tibia-idle/data';
import {
  advance, defaultSupplies, expectedExperiencePerHour, hourlyRates,
  huntThroughput, referenceCharacter, SPELLS, startSession, TICKS_PER_HOUR,
} from '../src/index.js';

/**
 * Economy guard rails.
 *
 * These do not pin exact numbers - combat tuning is expected to move - but they
 * fail if the economy breaks in a way that would ruin the game: experience
 * running away past the official rates, hunts becoming unplayable, or supply
 * costs swallowing all loot.
 */

function simulate(huntId: string, vocationId: number, level: number, ticks = TICKS_PER_HOUR) {
  const character = referenceCharacter(vocationId, level);
  character.supplies = defaultSupplies(character, 8);
  // Cures spend mana and raise uptime vs DoT; keep the official-rate rail on combat.
  character.policy.cure = false;
  // Calibration measures spawn-limited XP, not the extra mana tax of full spell rotation.
  character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
  character.policy.runeId = -1;
  const session = startSession(character, huntId, 20260814n);
  advance(session, ticks, { maxEvents: 0, creatureFlee: false });
  return session;
}

describe('experience throughput', () => {
  it('never exceeds a zone official rate', () => {
    // The spawn budget is what enforces this; without it a strong character
    // would farm a low level zone at unbounded speed. Sparse zones supply only
    // a few dozen monsters an hour, so a single sample carries real Poisson
    // noise: the per-zone bound is loose and the mean is what is pinned.
    const offenders: string[] = [];
    const ratios: number[] = [];

    for (const hunt of hunts.slice(0, 40)) {
      const target = expectedExperiencePerHour(hunt.id);
      if (target <= 0) continue;
      const session = simulate(hunt.id, 4, 800);
      const hours = session.totals.ticks / TICKS_PER_HOUR;
      if (hours <= 0) continue;

      const ratio = session.totals.rawExperience / hours / target;
      ratios.push(ratio);
      if (ratio > 1.15) offenders.push(`${hunt.name} ${ratio.toFixed(2)}x`);
    }

    expect(offenders).toEqual([]);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(mean).toBeLessThan(1.05);
  });

  it('reaches the official rate at the derived recommended level', () => {
    const sample = hunts.filter((h) => calibratedLevelFor(h.id, 4) !== null).slice(0, 12);
    expect(sample.length).toBeGreaterThan(0);

    for (const hunt of sample) {
      const level = calibratedLevelFor(hunt.id, 4)!;
      const session = simulate(hunt.id, 4, level, TICKS_PER_HOUR / 4);
      const hours = session.totals.ticks / TICKS_PER_HOUR;
      const ratio = session.totals.rawExperience / Math.max(hours, 1e-6) / expectedExperiencePerHour(hunt.id);
      expect(ratio, `${hunt.name} at level ${level}`).toBeGreaterThan(0.6);
    }
  });

  it('gives a character too weak for a zone much less experience', () => {
    const hunt = hunts.find((h) => (calibratedLevelFor(h.id, 4) ?? 0) > 200);
    expect(hunt).toBeDefined();
    const level = calibratedLevelFor(hunt!.id, 4)!;

    const strong = simulate(hunt!.id, 4, level, TICKS_PER_HOUR / 4);
    const weak = simulate(hunt!.id, 4, Math.round(level / 4), TICKS_PER_HOUR / 4);
    expect(weak.totals.rawExperience).toBeLessThan(strong.totals.rawExperience);
  });
});

describe('hunt data', () => {
  it('gives every hunt a usable monster pool', () => {
    for (const hunt of hunts) {
      expect(huntThroughput(hunt.id).monsters.length, hunt.name).toBeGreaterThan(0);
    }
  });

  it('derives a pack size inside sane bounds', () => {
    for (const hunt of hunts) {
      const { packSize } = huntThroughput(hunt.id);
      expect(packSize).toBeGreaterThanOrEqual(2);
      expect(packSize).toBeLessThanOrEqual(8);
    }
  });

  it('has a recommended level for the large majority of zones', () => {
    const covered = hunts.filter((h) => calibratedLevelFor(h.id) !== null).length;
    expect(covered / hunts.length).toBeGreaterThan(0.85);
  });
});

describe('economy', () => {
  it('leaves a profit at a well matched zone', () => {
    const hunt = hunts.find((h) => {
      const level = calibratedLevelFor(h.id, 4);
      return level !== null && level >= 20 && level <= 120;
    });
    expect(hunt).toBeDefined();

    const session = simulate(hunt!.id, 4, calibratedLevelFor(hunt!.id, 4)!);
    const rates = hourlyRates(session);
    expect(rates.lootPerHour).toBeGreaterThan(0);
    expect(rates.profitPerHour).toBeGreaterThan(0);
  });

  it('reports rates consistent with the totals', () => {
    const session = simulate(hunts[0]!.id, 4, 60, TICKS_PER_HOUR / 2);
    const rates = hourlyRates(session);
    const hours = session.totals.ticks / TICKS_PER_HOUR;
    expect(rates.killsPerHour).toBe(Math.round(session.totals.kills / hours));
  });
});
