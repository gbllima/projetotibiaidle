import { getHunt, getMonster, hunts, type Hunt, type Monster } from '@tibia-idle/data';
import { bossEncounterThroughput, getBossEncounterForHunt, isBossHunt } from './bossEncounters.js';

/**
 * How fast a hunting zone can hand out monsters.
 *
 * `killsPerHour` is intentionally a very high spawn budget for normal hunts so
 * clearing a wave immediately opens the next one. Balance calculations continue
 * to use `balanceKillsPerHour`, which preserves the official/inferred XP pacing
 * used everywhere else in the game.
 */
export interface HuntThroughput {
  /** Mean experience of one monster in the zone. */
  averageExperience: number;
  /** Spawn budget consumed by the combat loop. */
  killsPerHour: number;
  /** Official/inferred rate used for XP and DPS balance calculations. */
  balanceKillsPerHour: number;
  /** Mean health, used to estimate whether a character can keep up. */
  averageHealth: number;
  /** How many monsters are engaged at once. */
  packSize: number;
  /** True when the zone ships no official rate and we inferred one. */
  estimated: boolean;
  monsters: Monster[];
}

const CONTINUOUS_WAVE_SPAWN_RATE = 1_000_000_000;

const meanExperience = (hunt: Hunt): number => {
  const monsters = hunt.monsters.map(getMonster).filter((m) => m.experience > 0);
  if (monsters.length === 0) return 0;
  return monsters.reduce((sum, m) => sum + m.experience, 0) / monsters.length;
};

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
    const base = bossEncounterThroughput(encounter);
    const throughput: HuntThroughput = {
      ...base,
      balanceKillsPerHour: base.killsPerHour,
    };
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
  const balanceKillsPerHour = estimated
    ? medianKillsPerHour
    : Math.max(1, hunt.expectedXpPerHour / Math.max(1, averageExperience));

  const throughput: HuntThroughput = {
    averageExperience,
    averageHealth,
    killsPerHour: CONTINUOUS_WAVE_SPAWN_RATE,
    balanceKillsPerHour,
    packSize: packSizeFor(balanceKillsPerHour),
    estimated,
    monsters,
  };
  cache.set(huntId, throughput);
  return throughput;
}

/** Experience per hour a zone is worth, official or inferred. */
export function expectedExperiencePerHour(huntId: string): number {
  const { balanceKillsPerHour, averageExperience } = huntThroughput(huntId);
  return Math.round(balanceKillsPerHour * averageExperience);
}

/** Sustained damage per second needed to keep up with a zone's intended balance. */
export function requiredDamagePerSecond(huntId: string): number {
  const { balanceKillsPerHour, averageHealth } = huntThroughput(huntId);
  return (balanceKillsPerHour * averageHealth) / 3600;
}

export function throughputFit(huntId: string, damagePerSecond: number): number {
  const required = requiredDamagePerSecond(huntId);
  if (damagePerSecond <= 0 || required <= 0) return 0;
  return Math.min(1, damagePerSecond / required);
}
