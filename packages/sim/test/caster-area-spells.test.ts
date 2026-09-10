import { describe, expect, it } from 'vitest';
import {
  combatAreaDirection,
  combatAreaOffsets,
  DIRECTION_NORTH,
  DIRECTION_SOUTH,
  isInCombatArea,
  PLAYER_TILE,
  spellSplashVictims,
} from '../src/index.js';
import type { ActiveMonster } from '../src/types.js';

function monster(uid: number, tileX: number, tileY: number): ActiveMonster {
  return {
    uid,
    monsterId: 'rat',
    health: 100,
    maxHealth: 100,
    tileX,
    tileY,
    attackCooldowns: [],
    healCooldown: 0,
    paralyzeTicks: 0,
    holdTicks: 0,
  };
}

describe('caster area spells (SQM)', () => {
  it('wave4 extends forward from the caster, not on every engaged monster', () => {
    const south = monster(1, PLAYER_TILE.x, PLAYER_TILE.y + 2);
    const north = monster(2, PLAYER_TILE.x, PLAYER_TILE.y - 2);
    const facingSouth = combatAreaDirection(south.tileX, south.tileY);
    expect(facingSouth).toBe(DIRECTION_SOUTH);

    const victims = spellSplashVictims([south, north], 'wave4', facingSouth);
    expect(victims.map((entry) => entry.uid)).toContain(1);
    expect(victims.map((entry) => entry.uid)).not.toContain(2);
  });

  it('circle5 hits symmetrically around the caster tile', () => {
    const ring = [
      monster(1, PLAYER_TILE.x + 1, PLAYER_TILE.y),
      monster(2, PLAYER_TILE.x - 2, PLAYER_TILE.y + 2),
      monster(3, PLAYER_TILE.x + 3, PLAYER_TILE.y - 1),
    ];
    const victims = spellSplashVictims(ring, 'circle5');
    expect(victims.length).toBeGreaterThan(0);
    for (const entry of victims) {
      expect(isInCombatArea('circle5', PLAYER_TILE.x, PLAYER_TILE.y, entry.tileX, entry.tileY)).toBe(true);
    }
  });

  it('beam5 paints a line of SQMs in the cast direction', () => {
    const offsets = combatAreaOffsets('beam5', DIRECTION_SOUTH);
    expect(offsets).toContainEqual([0, 0]);
    expect(offsets.some(([dx, dy]) => dy > 0)).toBe(true);
    expect(offsets.some(([dx, dy]) => dx !== 0)).toBe(false);

    const northOffsets = combatAreaOffsets('beam5', DIRECTION_NORTH);
    expect(northOffsets.some(([dx, dy]) => dy < 0)).toBe(true);
  });
});
