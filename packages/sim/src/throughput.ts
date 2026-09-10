import { getHunt, getMonster, hunts, type Hunt, type Monster } from '@tibia-idle/data';
import { bossEncounterThroughput, getBossEncounterForHunt, isBossHunt } from './bossEncounters.js';

export interface HuntThroughput {
  averageExperience: number;
  /** Spawn budget consumed by the combat loop. */
  killsPerHour: number;
  /** Official/inferred rate used for balance calculations. Boss helpers may omit it. */
  balanceKillsPerHour?: number;
  averageHealth: number;
  packSize: number;
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
    const throughput: HuntThroughput = { ...base, balanceKillsPerHour: base.killsPerHour };
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

export function expectedExperiencePerHour(huntId: string): number {
  const throughput = huntThroughput(huntId);
  return Math.round((throughput.balanceKillsPerHour ?? throughput.killsPerHour) * throughput.averageExperience);
}

export function requiredDamagePerSecond(huntId: string): number {
  const throughput = huntThroughput(huntId);
  return ((throughput.balanceKillsPerHour ?? throughput.killsPerHour) * throughput.averageHealth) / 3600;
}

export function throughputFit(huntId: string, damagePerSecond: number): number {
  const required = requiredDamagePerSecond(huntId);
  if (damagePerSecond <= 0 || required <= 0) return 0;
  return Math.min(1, damagePerSecond / required);
}
