import { monstersById } from '@tibia-idle/data';
import type { CharacterState } from './types.js';

/** Wheel of Destiny unlocks after the early-game curve flattens. */
export const WHEEL_UNLOCK_LEVEL = 50;
export const WHEEL_RANK_CAP = 10;

export const WHEEL_NODES = [
  { id: 'combat', name: 'Combat Mastery', damage: 0.012, defense: 0, experience: 0, loot: 0, health: 0, mana: 0 },
  { id: 'blessing', name: 'Blessing', damage: 0, defense: 0, experience: 0.01, loot: 0, health: 0, mana: 0 },
  { id: 'fortune', name: 'Fortune', damage: 0, defense: 0, experience: 0, loot: 0.012, health: 0, mana: 0 },
  { id: 'guardian', name: 'Guardian', damage: 0, defense: 0.01, experience: 0, loot: 0, health: 0, mana: 0 },
  { id: 'vitality', name: 'Vitality', damage: 0, defense: 0, experience: 0, loot: 0, health: 0.015, mana: 0 },
  { id: 'focus', name: 'Focus', damage: 0, defense: 0, experience: 0, loot: 0, health: 0, mana: 0.015 },
] as const;

export type WheelNodeId = (typeof WHEEL_NODES)[number]['id'];

export const COIN_PACKS = [
  { id: 'pack100', name: '100 Knock Coins', coins: 100, brl: 6.90 },
  { id: 'pack550', name: '550 Knock Coins', coins: 550, brl: 29.90 },
  { id: 'pack1200', name: '1.200 Knock Coins', coins: 1200, brl: 59.90 },
  { id: 'pack2600', name: '2.600 Knock Coins', coins: 2600, brl: 119.90 },
  { id: 'pack5500', name: '5.500 Knock Coins', coins: 5500, brl: 229.90 },
] as const;

export interface WorldEvent {
  name: string;
  experience: number;
  loot: number;
}

const DEFAULT_EVENT: WorldEvent = { name: '', experience: 1, loot: 1 };
let worldEvent: WorldEvent = { ...DEFAULT_EVENT };

export function setWorldEvent(next: WorldEvent | null): void {
  worldEvent = next ? { ...DEFAULT_EVENT, ...next } : { ...DEFAULT_EVENT };
}

export function getWorldEvent(): WorldEvent {
  return worldEvent;
}

export function wheelPointsEarned(level: number): number {
  return Math.max(0, level - WHEEL_UNLOCK_LEVEL);
}

export function wheelPointsSpent(wheel: Record<string, number> | undefined): number {
  return Object.values(wheel ?? {}).reduce((sum, rank) => sum + Math.max(0, Math.floor(rank)), 0);
}

export function wheelPointsLeft(character: CharacterState): number {
  return Math.max(0, wheelPointsEarned(character.level) - wheelPointsSpent(character.wheel));
}

export function wheelBonus(character: CharacterState): {
  damage: number;
  defense: number;
  experience: number;
  loot: number;
  health: number;
  mana: number;
} {
  const bonus = { damage: 0, defense: 0, experience: 0, loot: 0, health: 0, mana: 0 };
  if (character.level < WHEEL_UNLOCK_LEVEL) return bonus;
  for (const node of WHEEL_NODES) {
    const rank = Math.min(WHEEL_RANK_CAP, Math.max(0, character.wheel?.[node.id] ?? 0));
    bonus.damage += node.damage * rank;
    bonus.defense += node.defense * rank;
    bonus.experience += node.experience * rank;
    bonus.loot += node.loot * rank;
    bonus.health += node.health * rank;
    bonus.mana += node.mana * rank;
  }
  return bonus;
}

/** Crystal `BosstiaryRarity_t` kill stages → boss points (io_bosstiary.hpp). */
export type BosstiaryRace = 'bane' | 'archfoe' | 'nemesis';

export const BOSSTIARY_STAGES: Record<BosstiaryRace, ReadonlyArray<{ kills: number; points: number }>> = {
  bane: [
    { kills: 25, points: 5 },
    { kills: 100, points: 15 },
    { kills: 300, points: 30 },
  ],
  archfoe: [
    { kills: 5, points: 10 },
    { kills: 20, points: 30 },
    { kills: 60, points: 60 },
  ],
  nemesis: [
    { kills: 1, points: 10 },
    { kills: 3, points: 30 },
    { kills: 5, points: 60 },
  ],
};

/** Crystal protocol: second boss slot unlocks at 1500 boss points. */
export const BOSSTIARY_SLOT_TWO_POINTS = 1500;
/** Mastery (stage 3) adds +25% loot on top of the global bosstiary loot bonus. */
export const BOSSTIARY_MASTERY_LOOT_BONUS = 25;

export function parseBosstiaryRace(raw: string | null | undefined): BosstiaryRace | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === 'bane' || s.includes('bane')) return 'bane';
  if (s === 'archfoe' || s.includes('archfoe')) return 'archfoe';
  if (s === 'nemesis' || s.includes('nemesis')) return 'nemesis';
  return null;
}

export function monsterBosstiaryRace(monsterId: string): BosstiaryRace | null {
  return parseBosstiaryRace(monstersById.get(monsterId)?.bosstiaryRace);
}

/** 0–3 stage from kill count for a rarity (Crystal getBossCurrentLevel). */
export function bossStage(kills: number, race: BosstiaryRace): number {
  let level = 0;
  for (const stage of BOSSTIARY_STAGES[race]) {
    if (kills >= stage.kills) level += 1;
  }
  return level;
}

/** Points awarded for stages reached on one boss (sum of stage point values). */
export function bossStagePoints(kills: number, race: BosstiaryRace): number {
  let points = 0;
  for (const stage of BOSSTIARY_STAGES[race]) {
    if (kills >= stage.kills) points += stage.points;
  }
  return points;
}

/** Total Crystal boss points from bosstiary kill map. */
export function bossPoints(bosstiary: Record<string, number> | undefined): number {
  let total = 0;
  for (const [monsterId, kills] of Object.entries(bosstiary ?? {})) {
    const race = monsterBosstiaryRace(monsterId);
    if (!race) continue;
    total += bossStagePoints(Math.max(0, kills | 0), race);
  }
  return total;
}

/**
 * Crystal slots: slot 1 when any boss reaches Base (stage ≥1);
 * slot 2 at 1500 boss points. Cap is 0–2 (boosted-boss day slot is separate).
 */
export function bossSlotCap(bosstiary: Record<string, number> | undefined): number {
  let unlockedBase = false;
  for (const [monsterId, kills] of Object.entries(bosstiary ?? {})) {
    const race = monsterBosstiaryRace(monsterId);
    if (!race) continue;
    if (bossStage(Math.max(0, kills | 0), race) >= 1) {
      unlockedBase = true;
      break;
    }
  }
  if (!unlockedBase) return 0;
  return bossPoints(bosstiary) >= BOSSTIARY_SLOT_TWO_POINTS ? 2 : 1;
}

/**
 * Crystal `IOBosstiary::calculateLootBonus` — percent used by slotted bosses.
 * Integer division mirrors the C++ uint32_t arithmetic.
 */
export function calculateBosstiaryLootBonus(points: number): number {
  const p = Math.max(0, Math.floor(points));
  if (p <= 250) return 25 + Math.floor(p / 10);
  if (p < 1250) return Math.floor(37.5 + Math.floor(p / 20));
  return Math.floor(100 + 0.5 * (Math.sqrt(8 * Math.floor((p - 1250) / 5) + 81) - 9));
}

/** Loot multiplier when `monsterId` is in a bosstiary slot (no XP bonus). */
export function slottedBossLootMultiplier(character: CharacterState, monsterId: string): number {
  if (!(character.bossSlots ?? []).includes(monsterId)) return 1;
  const race = monsterBosstiaryRace(monsterId);
  const kills = character.bosstiary?.[monsterId] ?? 0;
  const mastery = race != null && bossStage(kills, race) === 3;
  const percent =
    calculateBosstiaryLootBonus(bossPoints(character.bosstiary)) +
    (mastery ? BOSSTIARY_MASTERY_LOOT_BONUS : 0);
  return 1 + percent / 100;
}

/** Weapon proficiency: +0.2% damage per skill above 10, capped at +10%. */
export function proficiencyMultiplier(character: CharacterState): number {
  const skills = character.skills ?? {};
  const best = Math.max(
    10,
    skills.sword?.level ?? 10,
    skills.axe?.level ?? 10,
    skills.club?.level ?? 10,
    skills.distance?.level ?? 10,
    skills.fist?.level ?? 10,
    character.magicLevel ?? 0,
  );
  return 1 + Math.min(0.1, Math.max(0, best - 10) * 0.002);
}
