import { getHunt, getMonster, hunts, type Hunt, type Monster } from '@tibia-idle/data';
import { bossEncounterThroughput, getBossEncounterForHunt, isBossHunt } from './bossEncounters.js';

/**
 * How fast a hunting zone can hand out monsters.
 *
 * This is the load-bearing idea behind hunt balance. Every zone in
 * hunting_places.json ships an official Xp/Hour that CipSoft's own data
 * produced, and dividing it by the average experience of the zone's monsters
 * gives the number of kills per hour the zone supports. That number is spawn
 * density: in real Tibia a strong character is limited by how fast monsters
 * respawn, not by their damage.
 *
 * Feeding that rate into the simulation as a spawn budget gives us two things
 * at once. Every zone is calibrated against official numbers without
 * hand-tuning 131 of them, and a character who is too weak still underperforms,
 * because they cannot clear packs fast enough to use the budget.
 */

export interface HuntThroughput {
  /** Mean experience of one monster in the zone. */
  averageExperience: number;
  /** Monsters the zone can supply per hour. */
  killsPerHour: number;
  /** Mean health, used to estimate whether a character can keep up. */
  averageHealth: number;
  /** How many monsters are engaged at once. */
  packSize: number;
  /** True when the zone ships no official rate and we inferred one. */
  estimated: boolean;
  monsters: Monster[];
}

const meanExperience = (hunt: Hunt): number => {
  const monsters = hunt.monsters.map(getMonster).filter((m) => m.experience > 0);
  if (monsters.length === 0) return 0;
  return monsters.reduce((sum, m) => sum + m.experience, 0) / monsters.length;
};

/**
 * Fallback spawn rate for the six zones that ship no Xp/Hour.
 *
 * Taking the median across the zones that *do* have one keeps the estimate
 * anchored to real data and updates itself if the source is ever corrected,
 * which a hardcoded constant would not.
 */
const medianKillsPerHour = (() => {
  const rates: number[] = [];
  for (const hunt of hunts) {
    if (hunt.expectedXpPerHour <= 0) continue;
    const average = meanExperience(hunt);
    if (average > 0) rates.push(hunt.expectedXpPerHour / average);
  }
  if (rates.length === 0) return 300;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)] ?? 300;
})();

/**
 * Monsters fought simultaneously, from how densely the zone spawns.
 *
 * A zone that supplies a thousand monsters an hour is one where they arrive in
 * groups, and area damage is the only way anyone clears it. Fixing the pack
 * size instead would make dense high level zones unreachable for every
 * vocation, since no single-target rotation can keep up with the respawn rate.
 */
export function packSizeFor(killsPerHour: number): number {
  return Math.max(2, Math.min(8, Math.round(killsPerHour / 130)));
}

const cache = new Map<string, HuntThroughput>();

export function huntThroughput(huntId: string): HuntThroughput {
  const cached = cache.get(huntId);
  if (cached) return cached;

  if (isBossHunt(huntId)) {
    const encounter = getBossEncounterForHunt(huntId);
    if (!encounter) throw new Error(`unknown boss hunt: ${huntId}`);
    const throughput = bossEncounterThroughput(encounter);
    cache.set(huntId, throughput);
    return throughput;
  }

  const hunt: Hunt = getHunt(huntId);
  const monsters = hunt.monsters.map(getMonster).filter((m) => m.experience > 0);

  const averageExperience = monsters.length
    ? monsters.reduce((sum, m) => sum + m.experience, 0) / monsters.length
    : 1;
  const averageHealth = monsters.length
    ? monsters.reduce((sum, m) => sum + m.health, 0) / monsters.length
    : 1;

  const estimated = hunt.expectedXpPerHour <= 0;
  const killsPerHour = estimated
    ? medianKillsPerHour
    : Math.max(1, hunt.expectedXpPerHour / Math.max(1, averageExperience));

  const throughput: HuntThroughput = {
    averageExperience,
    averageHealth,
    killsPerHour,
    packSize: packSizeFor(killsPerHour),
    estimated,
    monsters,
  };
  cache.set(huntId, throughput);
  return throughput;
}

/** Experience per hour a zone is worth, official or inferred. */
export function expectedExperiencePerHour(huntId: string): number {
  const { killsPerHour, averageExperience } = huntThroughput(huntId);
  return Math.round(killsPerHour * averageExperience);
}

/** Sustained damage per second needed to keep up with a zone's respawns. */
export function requiredDamagePerSecond(huntId: string): number {
  const { killsPerHour, averageHealth } = huntThroughput(huntId);
  return (killsPerHour * averageHealth) / 3600;
}

/**
 * Rough check of whether a character belongs in a zone, for the UI.
 *
 * Returns the fraction of the zone's spawn budget the character could actually
 * consume: 1 means they can keep up with respawns, 0.3 means they will only
 * see about a third of the available experience.
 */
export function throughputFit(huntId: string, damagePerSecond: number): number {
  const required = requiredDamagePerSecond(huntId);
  if (damagePerSecond <= 0 || required <= 0) return 0;
  return Math.min(1, damagePerSecond / required);
}
