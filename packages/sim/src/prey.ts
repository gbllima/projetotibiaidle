import { hunts, monstersById, preyBonuses } from '@tibia-idle/data';
import type { CharacterState, PreyBonus, PreySlot } from './types.js';

export const PREY_DURATION_MS = 2 * 60 * 60 * 1000;
export const PREY_LIST_REROLL_MS = 20 * 60 * 60 * 1000;
export const PREY_GOLD_PER_LEVEL = 150;
/** @deprecated Use preyListRerollGold(level). */
export const PREY_REROLL_GOLD = 500;
export const PREY_WILDCARD_AUTO_BONUS = 1;
export const PREY_WILDCARD_LOCK = 5;
export const PREY_WILDCARD_PICK = 2;
export const PREY_CANDIDATE_COUNT = 9;

const PREY_BONUSES: PreyBonus[] = ['damage', 'defense', 'experience', 'loot'];

function isVip(character: CharacterState, now = 0): boolean {
  return character.premium && (character.vipUntil ?? 0) > now;
}

export function preySlotCount(character: CharacterState, now = 0): number {
  return isVip(character, now) ? 4 : 3;
}

export function emptyPreySlot(now = Date.now()): PreySlot {
  return {
    monsterId: null,
    candidates: [],
    bonus: 'experience',
    star: 0,
    locked: false,
    autoBonusReroll: false,
    listRerollAt: now + PREY_LIST_REROLL_MS,
    expiresAt: 0,
  };
}

export function normalizePreySlot(slot: PreySlot, now = Date.now()): PreySlot {
  return {
    ...emptyPreySlot(now),
    ...slot,
    candidates: slot.candidates ?? [],
    autoBonusReroll: slot.autoBonusReroll ?? false,
    listRerollAt: slot.listRerollAt ?? now,
  };
}

export function preyListRerollGold(level: number): number {
  return PREY_GOLD_PER_LEVEL * Math.max(1, level);
}

export function preyBonusPercent(bonus: PreyBonus, star: number): number {
  const table = preyBonuses[bonus];
  return table[Math.min(9, Math.max(0, star))] ?? 0;
}

export function preyPool(character: CharacterState): string[] {
  const fromBestiary = Object.keys(character.bestiary ?? {});
  if (fromBestiary.length >= 8) return fromBestiary.filter((id) => monstersById.has(id));
  const fromHunts = hunts
    .filter((hunt) => hunt.level <= character.level + 20)
    .flatMap((hunt) => hunt.monsters);
  return [...new Set([...fromBestiary, ...fromHunts])].filter((id) => monstersById.has(id));
}

export function isPreyActive(slot: PreySlot, now = Date.now()): boolean {
  return Boolean(slot.monsterId && slot.expiresAt > now);
}

export function isPreySelecting(slot: PreySlot, now = Date.now()): boolean {
  return !isPreyActive(slot, now) && (slot.candidates?.length ?? 0) > 0;
}

function pickRandom<T>(list: T[], rng: () => number): T | null {
  if (!list.length) return null;
  return list[Math.floor(rng() * list.length)] ?? null;
}

function shufflePick(pool: string[], count: number, exclude: string[], rng: () => number): string[] {
  const available = pool.filter((id) => !exclude.includes(id));
  const bag = [...available];
  const picked: string[] = [];
  while (picked.length < count && bag.length > 0) {
    const index = Math.floor(rng() * bag.length);
    picked.push(bag.splice(index, 1)[0]!);
  }
  while (picked.length < count && pool.length > 0) {
    picked.push(pickRandom(pool, rng)!);
  }
  return picked.slice(0, count);
}

export function rollPreyCandidates(
  character: CharacterState,
  exclude: string[] = [],
  rng: () => number = Math.random,
): string[] {
  const pool = preyPool(character);
  if (!pool.length) return ['rat'];
  return shufflePick(pool, PREY_CANDIDATE_COUNT, exclude, rng);
}

export function rollPreyActivation(rng: () => number = Math.random): Pick<PreySlot, 'bonus' | 'star'> {
  return {
    bonus: PREY_BONUSES[Math.floor(rng() * PREY_BONUSES.length)] ?? 'experience',
    star: Math.floor(rng() * 10),
  };
}

/** Crystal ioprey bonus reroll via Prey Wildcard. */
export function rollPreyBonusReroll(
  slot: PreySlot,
  rng: () => number = Math.random,
): Pick<PreySlot, 'bonus' | 'star'> {
  const currentBonus = slot.bonus;
  const currentStar = Math.min(9, Math.max(0, slot.star));
  if (currentStar >= 9) {
    let bonus = currentBonus;
    while (bonus === currentBonus) {
      bonus = PREY_BONUSES[Math.floor(rng() * PREY_BONUSES.length)] ?? 'experience';
    }
    return { bonus, star: 9 };
  }
  const star = currentStar + 1 + Math.floor(rng() * (9 - currentStar));
  const bonus = PREY_BONUSES[Math.floor(rng() * PREY_BONUSES.length)] ?? 'experience';
  return { bonus, star: Math.min(9, star) };
}

export function activatePreyMonster(
  slot: PreySlot,
  monsterId: string,
  now = Date.now(),
  rng: () => number = Math.random,
): PreySlot {
  const rolled = rollPreyActivation(rng);
  return {
    ...normalizePreySlot(slot, now),
    monsterId,
    candidates: [],
    bonus: rolled.bonus,
    star: rolled.star,
    expiresAt: now + PREY_DURATION_MS,
  };
}

export function rerollPreyList(
  slot: PreySlot,
  character: CharacterState,
  exclude: string[],
  now = Date.now(),
  rng: () => number = Math.random,
): PreySlot {
  return {
    ...normalizePreySlot(slot, now),
    monsterId: null,
    candidates: rollPreyCandidates(character, exclude, rng),
    expiresAt: 0,
    listRerollAt: now + PREY_LIST_REROLL_MS,
  };
}

export function preyWildcards(character: CharacterState): number {
  return character.preyWildcards ?? character.preyRerolls ?? 0;
}

export function syncPreyWildcards(character: CharacterState): void {
  const wild = preyWildcards(character);
  character.preyWildcards = wild;
  character.preyRerolls = wild;
}

export function ensurePreySlots(character: CharacterState, now = Date.now(), rng: () => number = Math.random): void {
  expirePreySlots(character, now, rng);
  const count = preySlotCount(character, now);
  character.prey ??= [];
  while (character.prey.length < count) character.prey.push(emptyPreySlot(now));
  character.prey = character.prey.slice(0, count).map((slot) => normalizePreySlot(slot, now));

  const used = character.prey.map((slot) => slot.monsterId).filter(Boolean) as string[];
  for (const slot of character.prey) {
    if (!isPreyActive(slot, now) && !isPreySelecting(slot, now)) {
      const exclude = used.filter((id) => id !== slot.monsterId);
      slot.candidates = rollPreyCandidates(character, exclude, rng);
      slot.monsterId = null;
      slot.expiresAt = 0;
    }
  }
  syncPreyWildcards(character);
}

export function expirePreySlots(character: CharacterState, now = Date.now(), rng: () => number = Math.random): void {
  const used: string[] = [];
  for (const slot of character.prey ?? []) {
    if (!slot.monsterId || slot.expiresAt > now) {
      if (slot.monsterId) used.push(slot.monsterId);
      continue;
    }

    if (slot.locked) {
      if (preyWildcards(character) >= PREY_WILDCARD_LOCK) {
        character.preyWildcards = preyWildcards(character) - PREY_WILDCARD_LOCK;
        slot.expiresAt = now + PREY_DURATION_MS;
        used.push(slot.monsterId);
        continue;
      }
      slot.locked = false;
    } else if (slot.autoBonusReroll) {
      if (preyWildcards(character) >= PREY_WILDCARD_AUTO_BONUS) {
        character.preyWildcards = preyWildcards(character) - PREY_WILDCARD_AUTO_BONUS;
        const rolled = rollPreyBonusReroll(slot, rng);
        slot.bonus = rolled.bonus;
        slot.star = rolled.star;
        slot.expiresAt = now + PREY_DURATION_MS;
        used.push(slot.monsterId);
        continue;
      }
      slot.autoBonusReroll = false;
    }

    slot.monsterId = null;
    slot.expiresAt = 0;
    slot.candidates = rollPreyCandidates(character, used, rng);
  }
  syncPreyWildcards(character);
}

export const PREY_BONUS_LABELS: Record<PreyBonus, string> = {
  damage: 'Dano',
  defense: 'Defesa',
  experience: 'Experiência',
  loot: 'Loot',
};
