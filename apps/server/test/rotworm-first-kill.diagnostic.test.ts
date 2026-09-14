import { describe, expect, it } from 'vitest';
import { itemsById } from '@tibia-idle/data';
import {
  advance, bestLoadout, createCharacter, deriveStats, loadoutCost, TICK_MS,
  type CharacterState,
} from '@tibia-idle/sim';
import { beginHunt } from '../src/settle.js';

function starterKnight(): CharacterState {
  const character = createCharacter('Diagnostic', 4);
  character.gender = 'm';
  character.startWeapon = 'sword';
  character.skills.sword.level = 12;
  character.gold = 10_000;
  character.equipment = bestLoadout(character, 3_000);
  character.gold -= loadoutCost(character.equipment);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  return character;
}

describe('starter Venore Rotworm diagnostic', () => {
  it('measures the first kill for a fresh tutorial-equivalent knight across seeds', () => {
    const sample: Array<{ seed: number; seconds: number; status: string; hp: number; kills: number }> = [];
    let equipment: Record<string, string> | null = null;

    for (let seed = 1; seed <= 64; seed += 1) {
      const character = starterKnight();
      if (!equipment) {
        equipment = Object.fromEntries(Object.entries(character.equipment).map(([slot, id]) => [
          slot,
          id ? `${itemsById.get(id)?.name ?? 'unknown'} (#${id})` : 'empty',
        ]));
      }
      const session = beginHunt(character, 'venore-rotworm-cave', BigInt(seed), { hours: 1 });
      let ticks = 0;
      const maxTicks = Math.ceil((10 * 60 * 1000) / TICK_MS);
      while (session.status === 'active' && session.totals.kills === 0 && ticks < maxTicks) {
        advance(session, 1, { maxEvents: 0 });
        ticks += 1;
      }
      sample.push({
        seed,
        seconds: Math.round((ticks * TICK_MS) / 100) / 10,
        status: session.status,
        hp: Math.round(session.character.health),
        kills: session.totals.kills,
      });
    }

    const killTimes = sample.filter((entry) => entry.kills > 0).map((entry) => entry.seconds);
    const sorted = [...killTimes].sort((a, b) => a - b);
    const average = killTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, killTimes.length);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
    const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]! : null;

    console.log('ROTWORM_FIRST_KILL_DIAGNOSTIC', JSON.stringify({
      tickMs: TICK_MS,
      equipment,
      successfulKills: killTimes.length,
      sampleSize: sample.length,
      minSeconds: sorted[0] ?? null,
      medianSeconds: median,
      averageSeconds: Math.round(average * 10) / 10,
      p90Seconds: p90,
      maxSeconds: sorted.at(-1) ?? null,
      sample,
    }));

    expect(killTimes.length).toBeGreaterThan(0);
  });
});
