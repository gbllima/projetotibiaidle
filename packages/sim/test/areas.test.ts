import { describe, expect, it } from 'vitest';
import { combatAreaOffsets, isInCombatArea, meleeSurroundSpots, spellSplashVictims } from '../src/index.js';

describe('Crystal combat areas', () => {
  it('circle3 matches AREA_CIRCLE3X3 (37 SQMs including center)', () => {
    expect(combatAreaOffsets('circle3')).toHaveLength(37);
    expect(isInCombatArea('circle3', 6, 5, 6, 5)).toBe(true);
    expect(isInCombatArea('circle3', 6, 5, 6, 2)).toBe(true); // radius 3
    expect(isInCombatArea('circle3', 6, 5, 3, 5)).toBe(true);
    expect(isInCombatArea('circle3', 6, 5, 6, 1)).toBe(false); // too far
    expect(isInCombatArea('circle3', 6, 5, 9, 8)).toBe(false); // corner cut
  });

  it('square1 matches burst / exori 3×3', () => {
    expect(combatAreaOffsets('square1')).toHaveLength(9);
    expect(isInCombatArea('square1', 6, 5, 7, 6)).toBe(true);
    expect(isInCombatArea('square1', 6, 5, 8, 5)).toBe(false);
  });

  it('divine caldera hits the melee surround pack via circle3', () => {
    const spots = meleeSurroundSpots().slice(0, 8);
    const pack = spots.map((tile, i) => ({
      uid: i + 1,
      monsterId: 'rat',
      health: 100,
      maxHealth: 100,
      tileX: tile.x,
      tileY: tile.y,
      attackCooldowns: [] as number[],
      healCooldown: 0,
    }));
    const hit = spellSplashVictims(pack, 'circle3');
    // All 8 surround seats sit inside CIRCLE3X3 of the player.
    expect(hit.length).toBe(8);
  });
});
