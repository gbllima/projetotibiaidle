import type { CombatType } from '@tibia-idle/data';
import type { CharacterState, HuntPolicy, HuntSummon } from './types.js';
import type { SpellGroup } from './spells.js';

/**
 * Runes with soul costs and support effects.
 *
 * Soulfire applies a fire DoT on the target (Crystal: 10 ticks × 10 dmg / 2s).
 * Animate dead raises a skeleton ally for 60 s — at most two summons, like Tibia.
 */

export interface SoulAttackRune {
  itemId: number;
  name: string;
  level: number;
  magicLevel: number;
  basePower: number;
  damageType: CombatType;
  cooldown: number;
  shoot: string;
  soulCost: number;
  group: SpellGroup;
  /** DoT applied after the initial hit. */
  dotDamage: number;
  dotTicks: number;
  dotIntervalMs: number;
  vocations: number[];
}

export interface SupportRune {
  itemId: number;
  name: string;
  level: number;
  magicLevel: number;
  cooldown: number;
  soulCost: number;
  group: SpellGroup;
  vocations: number[];
  durationMs: number;
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const SOUL_ATTACK_RUNES: SoulAttackRune[] = [
  {
    itemId: 3195, name: 'soulfire rune',
    level: 27, magicLevel: 7, basePower: 20,
    damageType: 'COMBAT_FIREDAMAGE', cooldown: 2000,
    shoot: 'CONST_ANI_FIRE', soulCost: 1, group: 'attack',
    dotDamage: 10, dotTicks: 10, dotIntervalMs: 2000,
    vocations: ALL,
  },
];

export const SUPPORT_RUNES: SupportRune[] = [
  {
    itemId: 3203, name: 'animate dead rune',
    level: 27, magicLevel: 4, cooldown: 2000, soulCost: 2,
    group: 'support', vocations: ALL, durationMs: 60_000,
  },
];

export function soulAttackById(itemId: number): SoulAttackRune | undefined {
  return SOUL_ATTACK_RUNES.find((rune) => rune.itemId === itemId);
}

export function supportRuneById(itemId: number): SupportRune | undefined {
  return SUPPORT_RUNES.find((rune) => rune.itemId === itemId);
}

export function bestSoulAttackRune(
  vocationId: number,
  level: number,
  magicLevel: number,
  soul: number,
): SoulAttackRune | null {
  let best: SoulAttackRune | null = null;
  let bestScore = -1;
  for (const rune of SOUL_ATTACK_RUNES) {
    if (!rune.vocations.includes(vocationId)) continue;
    if (level < rune.level || magicLevel < rune.magicLevel) continue;
    if (soul < rune.soulCost) continue;
    const score = (rune.basePower + rune.dotDamage * rune.dotTicks) / (rune.cooldown / 1000);
    if (score > bestScore) {
      bestScore = score;
      best = rune;
    }
  }
  return best;
}

export function chooseSoulAttackRune(
  character: CharacterState,
  policy: HuntPolicy | undefined,
): SoulAttackRune | null {
  const runeId = policy?.soulRuneId ?? -1;
  if (runeId < 0) return null;
  const soul = character.soul ?? 0;
  const preferred = runeId > 0 ? soulAttackById(runeId) : null;
  const rune = preferred
    && preferred.vocations.includes(character.vocationId)
    && character.level >= preferred.level
    && character.magicLevel >= preferred.magicLevel
    && soul >= preferred.soulCost
    ? preferred
    : bestSoulAttackRune(character.vocationId, character.level, character.magicLevel, soul);
  if (!rune) return null;
  if (!character.supplies.some((stack) => stack.itemId === rune.itemId && stack.count > 0)) return null;
  return rune;
}

export function chooseSupportRune(
  character: CharacterState,
  policy: HuntPolicy | undefined,
  summonCount: number,
): SupportRune | null {
  const runeId = policy?.supportRuneId ?? -1;
  if (runeId < 0 || summonCount >= 2) return null;
  const soul = character.soul ?? 0;
  const rune = (runeId > 0 ? supportRuneById(runeId) : SUPPORT_RUNES[0]) ?? null;
  if (!rune) return null;
  if (!rune.vocations.includes(character.vocationId)) return null;
  if (character.level < rune.level || character.magicLevel < rune.magicLevel) return null;
  if (soul < rune.soulCost) return null;
  if (!character.supplies.some((stack) => stack.itemId === rune.itemId && stack.count > 0)) return null;
  return rune;
}

/** Crystal skeleton: modest physical hits for one minute. */
export function spawnSkeleton(session: { nextUid: number; tick: number }, durationMs: number): HuntSummon {
  const ticks = Math.max(1, Math.round(durationMs / 250));
  return {
    uid: session.nextUid++,
    name: 'Skeleton',
    minDamage: 15,
    maxDamage: 35,
    ticksLeft: ticks,
    attackCooldown: 0,
  };
}
