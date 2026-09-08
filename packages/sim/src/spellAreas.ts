import {
  combatAreaDirection,
  isInCombatArea,
  PLAYER_TILE,
  type CombatAreaId,
} from './areas.js';
import type { ActiveMonster } from './types.js';

/**
 * Caster-centered spell AoE using Crystal createCombatArea SQM tables.
 * Directional waves/beams face the primary target tile.
 */
export function spellSplashVictims(
  active: readonly ActiveMonster[],
  shape: CombatAreaId,
  direction?: number,
): ActiveMonster[] {
  const sorted = [...active].sort((a, b) => a.uid - b.uid);
  if (!sorted.length) return [];

  const focus = sorted[0]!;
  const facing = direction ?? combatAreaDirection(focus.tileX, focus.tileY);
  const hit = sorted.filter((monster) => (
    isInCombatArea(shape, PLAYER_TILE.x, PLAYER_TILE.y, monster.tileX, monster.tileY, facing)
  ));
  return hit.length ? hit : [focus];
}

export function spellAreaTargetCount(
  active: readonly ActiveMonster[],
  shape: CombatAreaId,
): number {
  return spellSplashVictims(active, shape).length;
}
