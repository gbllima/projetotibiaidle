import { describe, expect, it } from 'vitest';
import {
  advance,
  bestLoadout,
  createCharacter,
  deriveStats,
  startSession,
  TICK_MS,
} from '../src/index.js';

function starterKnight() {
  const character = createCharacter('Starter', 4);
  character.level = 8;
  character.startWeapon = 'sword';
  character.skills.sword.level = 12;
  character.equipment = bestLoadout(character, 3_000);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  return character;
}

function firstKillSeconds(seed: number): number {
  const session = startSession(starterKnight(), 'venore-rotworm-cave', BigInt(seed));
  let ticks = 0;
  while (session.status === 'active' && session.totals.kills === 0 && ticks < 400) {
    advance(session, 1, { maxEvents: 0 });
    ticks += 1;
  }
  expect(session.totals.kills).toBe(1);
  return (ticks * TICK_MS) / 1000;
}

describe('starter pacing diagnostic', () => {
  it('prints the 64-seed first-kill distribution', () => {
    const times = Array.from({ length: 64 }, (_, index) => firstKillSeconds(index + 1)).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p90 = times[Math.floor(times.length * 0.9)]!;
    const average = times.reduce((sum, value) => sum + value, 0) / times.length;
    console.log('STARTER_PACING_DIAGNOSTIC', JSON.stringify({
      min: times[0],
      median,
      average: Number(average.toFixed(1)),
      p90,
      max: times[times.length - 1],
      times,
    }));
    expect(median).toBeGreaterThanOrEqual(20);
    expect(median).toBeLessThanOrEqual(50);
  });
});
