/**
 * Hunt wave ladder.
 *
 * Ten discrete packs with a fixed size each. Count climbs until the cap, then
 * wave 10 is a single cave creature with ×5 health / XP / loot (skull pip).
 */

export const WAVES_TOTAL = 10;
export const WAVE_PACK_CAP = 14;
export const BOSS_WAVE_INDEX = 9;
/** HP of the wave-10 creature relative to its normal form. */
export const BOSS_HEALTH_MULT = 5;
/** XP and loot multiplier for the skull wave (matches HP mult). */
export const BOSS_REWARD_MULT = 5;

/** Fixed monsters on waves 1–10 (last entry is the skull boss). */
export const WAVE_PACK = [3, 5, 7, 9, 11, 13, 14, 14, 14, 1] as const;

export const WAVE_CYCLE_KILLS = WAVE_PACK.reduce((sum, count) => sum + count, 0);

export interface WaveProgress {
  /** 0–9 */
  waveIndex: number;
  /** Kills already scored inside this wave. */
  killed: number;
  /** How many creatures this wave wants on the floor. */
  size: number;
}

export function waveProgress(kills: number): WaveProgress {
  let remaining = ((Math.max(0, kills) % WAVE_CYCLE_KILLS) + WAVE_CYCLE_KILLS) % WAVE_CYCLE_KILLS;
  for (let index = 0; index < WAVE_PACK.length; index += 1) {
    const size = WAVE_PACK[index]!;
    if (remaining < size) return { waveIndex: index, killed: remaining, size };
    remaining -= size;
  }
  return { waveIndex: BOSS_WAVE_INDEX, killed: 0, size: 1 };
}

export function wavePackSize(waveIndex: number): number {
  if (waveIndex === BOSS_WAVE_INDEX) return 1;
  return Math.min(WAVE_PACK_CAP, WAVE_PACK[waveIndex] ?? WAVE_PACK[0]!);
}

export function isBossWave(waveIndex: number): boolean {
  return waveIndex === BOSS_WAVE_INDEX;
}
