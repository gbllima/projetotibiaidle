/**
 * Monk Harmony — Crystal Server combat.cpp / player.cpp.
 *
 * Stacks 0–5. Builders `addHarmony(1)`. Spenders require at least 1 stack,
 * multiply damage by 7/14/28/56/112% (doubling each stack), then reset to 0
 * (Virtue of Harmony keeps a floor of 1).
 */

export const HARMONY_MAX = 5;
/** Base percent at 1 stack; each extra stack doubles: 7, 14, 28, 56, 112. */
export const HARMONY_BASE_PERCENT = 7;

export type HarmonyRole = 'build' | 'spend';

export function clampHarmony(value: number, virtueHarmony = false): number {
  const floor = virtueHarmony ? 1 : 0;
  return Math.min(HARMONY_MAX, Math.max(floor, Math.floor(value)));
}

/** Crystal: base * 2^(stacks-1). Virtue of Harmony adds +3 to the base. */
export function harmonyBonusPercent(stacks: number, virtueHarmony = false): number {
  const points = Math.min(HARMONY_MAX, Math.max(0, Math.floor(stacks)));
  if (points <= 0) return 0;
  const base = HARMONY_BASE_PERCENT + (virtueHarmony ? 3 : 0);
  return base * (1 << (points - 1));
}

export function harmonyDamageMultiplier(stacks: number, virtueHarmony = false): number {
  return 1 + harmonyBonusPercent(stacks, virtueHarmony) / 100;
}

export function addHarmony(current: number, amount = 1, virtueHarmony = false): number {
  return clampHarmony(current + amount, virtueHarmony);
}

/** After a spender cast: clear stacks, keep virtue floor. */
export function spendHarmony(virtueHarmony = false): number {
  return virtueHarmony ? 1 : 0;
}
