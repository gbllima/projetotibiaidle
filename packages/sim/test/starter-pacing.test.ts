import { describe, expect, it } from 'vitest';
import { getMonster } from '@tibia-idle/data';
import {
  advance,
  bestLoadout,
  createCharacter,
  deriveStats,
  startSession,
  TICK_MS,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

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
  const session = startSession(starterKnight(), HUNT, BigInt(seed));
  let ticks = 0;
  const limit = Math.ceil(90_000 / TICK_MS);
  while (session.status === 'active' && session.totals.kills === 0 && ticks < limit) {
    advance(session, 1, { maxEvents: 0 });
    ticks += 1;
  }
  expect(session.totals.kills).toBeGreaterThan(0);
  return (ticks * TICK_MS) / 1000;
}

describe('starter Venore combat pacing', () => {
  it('puts a fresh Knight first kill in the intended onboarding window across RNG seeds', () => {
    const times = Array.from({ length: 64 }, (_, index) => firstKillSeconds(index + 1))
      .sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p90 = times[Math.floor(times.length * 0.9)]!;

    expect(median).toBeGreaterThanOrEqual(20);
    expect(median).toBeLessThanOrEqual(50);
    expect(p90).toBeLessThanOrEqual(65);
  });

  it('reduces only the remaining first three lifetime Rotworms', () => {
    const regularHealth = getMonster('rotworm').health;

    const fresh = starterKnight();
    const firstSession = startSession(fresh, HUNT, 101n);
    expect(firstSession.active.filter((monster) => monster.maxHealth < regularHealth)).toHaveLength(3);

    const almostDone = starterKnight();
    almostDone.bestiary.rotworm = 2;
    const remainingSession = startSession(almostDone, HUNT, 102n);
    expect(remainingSession.active.filter((monster) => monster.maxHealth < regularHealth)).toHaveLength(1);

    const completed = starterKnight();
    completed.bestiary.rotworm = 3;
    const normalSession = startSession(completed, HUNT, 103n);
    expect(normalSession.active.every((monster) => monster.maxHealth === regularHealth)).toBe(true);
  });

  it('does not apply starter pacing after level 10', () => {
    const character = starterKnight();
    character.level = 11;
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = stats.maxMana;
    const regularHealth = getMonster('rotworm').health;
    const session = startSession(character, HUNT, 104n);
    expect(session.active.every((monster) => monster.maxHealth === regularHealth)).toBe(true);
  });
});
