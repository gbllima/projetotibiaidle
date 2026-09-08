import {
  DIRECTION_NORTH,
  DIRECTION_SOUTH,
  DIRECTION_WEST,
} from './atlas.js';

export const WALK_MIN_X = 1;
export const WALK_MAX_X = 11;
export const WALK_MIN_Y = 1;
export const WALK_MAX_Y = 9;
export const PLAYER_STEP_MS = 320;
export const MONSTER_STEP_MS = 420;

const SPAWN_SPOTS: Array<{ x: number; y: number }> = [
  { x: 2, y: 2 }, { x: 10, y: 2 }, { x: 2, y: 8 }, { x: 10, y: 8 },
  { x: 1, y: 5 }, { x: 11, y: 5 }, { x: 6, y: 1 }, { x: 6, y: 9 },
  { x: 3, y: 1 }, { x: 9, y: 1 }, { x: 3, y: 9 }, { x: 9, y: 9 },
  { x: 1, y: 3 }, { x: 11, y: 3 }, { x: 1, y: 7 }, { x: 11, y: 7 },
  { x: 4, y: 2 }, { x: 8, y: 2 }, { x: 4, y: 8 }, { x: 8, y: 8 },
  { x: 2, y: 4 }, { x: 10, y: 4 }, { x: 2, y: 6 }, { x: 10, y: 6 },
];

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

export function clampTile(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(WALK_MIN_X, Math.min(WALK_MAX_X, x)),
    y: Math.max(WALK_MIN_Y, Math.min(WALK_MAX_Y, y)),
  };
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The 8 SQMs around a target (Crystal melee ring / targetDistance 1). */
export function adjacentRing(cx: number, cy: number): Array<{ x: number; y: number }> {
  const ring: Array<{ x: number; y: number }> = [];
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const tile = clampTile(cx + ox, cy + oy);
      if (tile.x === cx && tile.y === cy) continue;
      ring.push(tile);
    }
  }
  return ring;
}

/**
 * Free stand tile next to the target — monsters path here, not onto the
 * player, so the pack surrounds instead of queuing in a single file.
 *
 * Once a creature is already on any ring SQM, callers should stop moving
 * (see CombatScene.chaseMonster) — this only picks a goal while approaching.
 *
 * `salt` (uid) breaks distance ties so each creature prefers a different SQM.
 */
export function surroundGoal(
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  blocked: Set<string>,
  salt = 0,
): { x: number; y: number } | null {
  // Treat the seeker's current tile as free so an occupied self-tile still counts as "hold".
  const free = adjacentRing(targetX, targetY).filter((tile) => {
    if (tile.x === fromX && tile.y === fromY) return true;
    return !blocked.has(tileKey(tile.x, tile.y));
  });
  if (free.length === 0) return null;

  if (free.some((tile) => tile.x === fromX && tile.y === fromY)) {
    return { x: fromX, y: fromY };
  }

  free.sort((a, b) => {
    const da = chebyshev(fromX, fromY, a.x, a.y);
    const db = chebyshev(fromX, fromY, b.x, b.y);
    if (da !== db) return da - db;
    const ja = (a.x * 13 + a.y * 7 + salt * 3) % 23;
    const jb = (b.x * 13 + b.y * 7 + salt * 3) % 23;
    return ja - jb;
  });
  return free[0] ?? null;
}

/**
 * One greedy step toward a goal. Tries diagonal first, then cardinals, then
 * sideways slips so creatures can flow around a blocked SQM instead of stacking.
 */
export function stepToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  blocked: Set<string>,
): { x: number; y: number } | null {
  const dx = sign(toX - fromX);
  const dy = sign(toY - fromY);
  if (dx === 0 && dy === 0) return null;

  const candidates: Array<{ x: number; y: number }> = [
    { x: fromX + dx, y: fromY + dy },
    { x: fromX + dx, y: fromY },
    { x: fromX, y: fromY + dy },
  ];
  if (dx !== 0 && dy !== 0) {
    candidates.push({ x: fromX + dx, y: fromY - dy }, { x: fromX - dx, y: fromY + dy });
  } else if (dx !== 0) {
    candidates.push(
      { x: fromX + dx, y: fromY + 1 },
      { x: fromX + dx, y: fromY - 1 },
      { x: fromX, y: fromY + 1 },
      { x: fromX, y: fromY - 1 },
    );
  } else {
    candidates.push(
      { x: fromX + 1, y: fromY + dy },
      { x: fromX - 1, y: fromY + dy },
      { x: fromX + 1, y: fromY },
      { x: fromX - 1, y: fromY },
    );
  }

  const startDist = chebyshev(fromX, fromY, toX, toY);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < candidates.length; i += 1) {
    const raw = candidates[i]!;
    const tile = clampTile(raw.x, raw.y);
    if (tile.x === fromX && tile.y === fromY) continue;
    if (blocked.has(tileKey(tile.x, tile.y))) continue;
    const dist = chebyshev(tile.x, tile.y, toX, toY);
    // Never step farther away unless every closer option is blocked (score still prefers closer).
    const score = dist * 10 + i + (dist > startDist ? 50 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

export function spawnTile(
  index: number,
  occupied: Set<string>,
  playerX: number,
  playerY: number,
): { x: number; y: number } {
  for (let offset = 0; offset < SPAWN_SPOTS.length; offset += 1) {
    const spot = SPAWN_SPOTS[(index + offset) % SPAWN_SPOTS.length]!;
    if (occupied.has(tileKey(spot.x, spot.y))) continue;
    if (spot.x === playerX && spot.y === playerY) continue;
    return spot;
  }
  return { x: WALK_MIN_X, y: WALK_MIN_Y };
}

/**
 * Facing for the packed atlas (south + west only; east = mirrored west).
 * North isn't packed — use a west profile so creatures never moonwalk south
 * sprites while moving up the screen.
 */
export function faceOf(dx: number, dy: number): { direction: number; scaleX: number } {
  if (dx === 0 && dy === 0) {
    return { direction: DIRECTION_SOUTH, scaleX: 1 };
  }

  // Dominant horizontal → west / mirrored east.
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return { direction: DIRECTION_WEST, scaleX: dx > 0 ? -1 : 1 };
  }

  // Moving / looking south — front view.
  if (dy > 0) {
    return { direction: DIRECTION_SOUTH, scaleX: 1 };
  }

  // North (or north-ish without enough dx): profile instead of south (backs).
  if (dx !== 0) {
    return { direction: DIRECTION_WEST, scaleX: dx > 0 ? -1 : 1 };
  }
  return { direction: DIRECTION_WEST, scaleX: 1 };
}

/** True 4-way intent (for logic); `faceOf` maps it onto packed art. */
export function facingIntent(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return DIRECTION_SOUTH;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return dx > 0 ? 1 /* east */ : DIRECTION_WEST;
  }
  return dy > 0 ? DIRECTION_SOUTH : DIRECTION_NORTH;
}
