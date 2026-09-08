import type { BossCategory, BossEncounter, Monster } from '@tibia-idle/data';
import { bossEncounters as bossEncountersCatalog, getMonster, monstersById } from '@tibia-idle/data';
import type { HuntThroughput } from './throughput.js';

export type { BossCategory, BossEncounter } from '@tibia-idle/data';

/** Tibia lever default: 20 hours between kills (Crystal BOSS_DEFAULT_TIME_TO_FIGHT_AGAIN). */
export const BOSS_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export const BOSS_HUNT_PREFIX = 'boss:';

export function bossHuntId(encounterId: string): string {
  return `${BOSS_HUNT_PREFIX}${encounterId}`;
}

export function parseBossHuntId(huntId: string): string | null {
  return huntId.startsWith(BOSS_HUNT_PREFIX) ? huntId.slice(BOSS_HUNT_PREFIX.length) : null;
}

export function isBossHunt(huntId: string): boolean {
  return huntId.startsWith(BOSS_HUNT_PREFIX);
}

/** Only entries whose monster exists in datagen. */
const ENCOUNTERS = bossEncountersCatalog.filter((entry) => monstersById.has(entry.monsterId));

export const bossEncounters = ENCOUNTERS;
export const bossEncountersById = new Map(ENCOUNTERS.map((entry) => [entry.id, entry]));

export function getBossEncounter(id: string): BossEncounter {
  const entry = bossEncountersById.get(id);
  if (!entry) throw new Error(`unknown boss encounter: ${id}`);
  return entry;
}

export function getBossEncounterForHunt(huntId: string): BossEncounter | null {
  const id = parseBossHuntId(huntId);
  return id ? bossEncountersById.get(id) ?? null : null;
}

export function bossEncountersByCategory(category: BossCategory): BossEncounter[] {
  return ENCOUNTERS.filter((entry) => entry.category === category);
}

export function bossCooldownUntil(character: { bossCooldowns?: Record<string, number> }, encounterId: string): number {
  return character.bossCooldowns?.[encounterId] ?? 0;
}

export function bossOnCooldown(character: { bossCooldowns?: Record<string, number> }, encounterId: string, now = Date.now()): boolean {
  return bossCooldownUntil(character, encounterId) > now;
}

export function bossCooldownRemainingMs(
  character: { bossCooldowns?: Record<string, number> },
  encounterId: string,
  now = Date.now(),
): number {
  return Math.max(0, bossCooldownUntil(character, encounterId) - now);
}

export function recordBossKill(
  character: { bossCooldowns?: Record<string, number> },
  encounterId: string,
  now = Date.now(),
): void {
  character.bossCooldowns ??= {};
  character.bossCooldowns[encounterId] = now + BOSS_COOLDOWN_MS;
}

export function bossEncounterThroughput(encounter: BossEncounter): HuntThroughput {
  const monster = getMonster(encounter.monsterId);
  return syntheticBossThroughput(monster);
}

export function syntheticBossThroughput(monster: Monster): HuntThroughput {
  const health = Math.max(1, monster.health);
  const xp = Math.max(1, monster.experience);
  return {
    monsters: [monster],
    killsPerHour: 3600,
    averageHealth: health,
    averageExperience: xp,
    packSize: 1,
    estimated: true,
  };
}
