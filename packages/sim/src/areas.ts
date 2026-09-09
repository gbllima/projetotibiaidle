/**
 * Crystal createCombatArea tables from
 * `servidor/data/scripts/lib/register_spells.lua` and weapons/scripts/*arrow*.lua`.
 */

export type CombatAreaId =
  | 'burst3'
  | 'diamond5'
  | 'storm5'
  | 'square1'
  | 'circle3'
  | 'wave4'
  | 'squarewave5'
  | 'beam5'
  | 'circle5';

export const DIRECTION_NORTH = 0;
export const DIRECTION_EAST = 1;
export const DIRECTION_SOUTH = 2;
export const DIRECTION_WEST = 3;

/** Player stand tile in the idle viewport (CombatScene). */
export const PLAYER_TILE = { x: 6, y: 5 } as const;

/** Same corner/edge seats the client uses in walk.ts — keeps ammo splash from
 *  stacking the whole pack inside one 3×3 (burst was hitting everyone). */
export const SPREAD_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 2, y: 2 }, { x: 10, y: 2 }, { x: 2, y: 8 }, { x: 10, y: 8 },
  { x: 1, y: 5 }, { x: 11, y: 5 }, { x: 6, y: 1 }, { x: 6, y: 9 },
  { x: 3, y: 1 }, { x: 9, y: 1 }, { x: 3, y: 9 }, { x: 9, y: 9 },
  { x: 1, y: 3 }, { x: 11, y: 3 }, { x: 1, y: 7 }, { x: 11, y: 7 },
  { x: 4, y: 2 }, { x: 8, y: 2 }, { x: 4, y: 8 }, { x: 8, y: 8 },
  { x: 2, y: 4 }, { x: 10, y: 4 }, { x: 2, y: 6 }, { x: 10, y: 6 },
];

type AreaMatrix = readonly (readonly number[])[];

/** AREA_WAVE4 — fire wave / ice wave (exevo * hur). */
const AREA_WAVE4: AreaMatrix = [
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 1, 1, 1, 0],
  [0, 0, 3, 0, 0],
];

/** AREA_SQUAREWAVE5 — terra/energy/strong ice wave. */
const AREA_SQUAREWAVE5: AreaMatrix = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [0, 1, 0],
  [0, 3, 0],
];

/** AREA_BEAM5 — energy beam (exevo vis lux). */
const AREA_BEAM5: AreaMatrix = [
  [1],
  [1],
  [1],
  [1],
  [3],
];

/** AREA_SQUARE1X1 — berserk / exori min. */
const AREA_SQUARE1X1: AreaMatrix = [
  [1, 1, 1],
  [1, 3, 1],
  [1, 1, 1],
];

/** AREA_CIRCLE3X3 — great fireball / divine caldera / groundshaker. */
const AREA_CIRCLE3X3: AreaMatrix = [
  [0, 0, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 3, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 0, 0],
];

/** AREA_CIRCLE5X5 — hell's core / eternal winter. */
const AREA_CIRCLE5X5: AreaMatrix = [
  [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
];

const DIRECTIONAL_AREAS = new Set<CombatAreaId>(['wave4', 'squarewave5', 'beam5']);

const SYMMETRIC_MATRIX: Partial<Record<CombatAreaId, AreaMatrix>> = {
  square1: AREA_SQUARE1X1,
  circle3: AREA_CIRCLE3X3,
  circle5: AREA_CIRCLE5X5,
};

const DIRECTIONAL_MATRIX: Partial<Record<CombatAreaId, AreaMatrix>> = {
  wave4: AREA_WAVE4,
  squarewave5: AREA_SQUAREWAVE5,
  beam5: AREA_BEAM5,
};

/** Storm / shatterstorm 13-SQM cross (firestorm_arrow.lua). */
const STORM_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -2],
  [-1, -1], [0, -1], [1, -1],
  [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
  [-1, 1], [0, 1], [1, 1],
  [0, 2],
];

function rotateForwardLateral(forward: number, lateral: number, direction: number): [number, number] {
  switch (direction & 3) {
    case DIRECTION_NORTH: return [-lateral, -forward];
    case DIRECTION_EAST: return [forward, lateral];
    case DIRECTION_SOUTH: return [lateral, forward];
    case DIRECTION_WEST: return [-forward, -lateral];
    default: return [lateral, forward];
  }
}

function symmetricMatrixOffsets(matrix: AreaMatrix): Array<[number, number]> {
  let casterRow = 0;
  let casterCol = 0;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row]!.length; col += 1) {
      if (matrix[row]![col] === 3) {
        casterRow = row;
        casterCol = col;
      }
    }
  }
  const out: Array<[number, number]> = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row]!.length; col += 1) {
      const cell = matrix[row]![col]!;
      if (cell !== 1 && cell !== 3) continue;
      out.push([col - casterCol, row - casterRow]);
    }
  }
  return out;
}

function directionalMatrixOffsets(matrix: AreaMatrix, direction: number): Array<[number, number]> {
  let casterRow = 0;
  let casterCol = 0;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row]!.length; col += 1) {
      if (matrix[row]![col] === 3) {
        casterRow = row;
        casterCol = col;
      }
    }
  }
  const out: Array<[number, number]> = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row]!.length; col += 1) {
      const cell = matrix[row]![col]!;
      if (cell !== 1 && cell !== 3) continue;
      const forward = casterRow - row;
      const lateral = col - casterCol;
      out.push(rotateForwardLateral(forward, lateral, direction));
    }
  }
  return out;
}

const offsetCache = new Map<string, readonly [number, number][]>();

function cachedOffsets(area: CombatAreaId, direction: number): readonly [number, number][] {
  const key = `${area}:${direction}`;
  const existing = offsetCache.get(key);
  if (existing) return existing;
  const symmetric = SYMMETRIC_MATRIX[area];
  const directional = DIRECTIONAL_MATRIX[area];
  const offsets = symmetric
    ? symmetricMatrixOffsets(symmetric)
    : directional
      ? directionalMatrixOffsets(directional, direction)
      : [];
  offsetCache.set(key, offsets);
  return offsets;
}

/** Offsets relative to the combat center (impact or caster). */
export function combatAreaOffsets(
  area: CombatAreaId,
  direction = DIRECTION_SOUTH,
): ReadonlyArray<readonly [number, number]> {
  if (area === 'burst3' || area === 'square1') {
    return cachedOffsets('square1', direction);
  }
  if (area === 'diamond5') {
    const out: Array<[number, number]> = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
        out.push([dx, dy]);
      }
    }
    return out;
  }
  if (area === 'storm5') return STORM_OFFSETS;
  if (SYMMETRIC_MATRIX[area] || DIRECTIONAL_MATRIX[area]) {
    return cachedOffsets(area, direction);
  }
  return cachedOffsets('circle3', direction);
}

export function isInCombatArea(
  area: CombatAreaId,
  focusX: number,
  focusY: number,
  x: number,
  y: number,
  direction = DIRECTION_SOUTH,
): boolean {
  const dx = x - focusX;
  const dy = y - focusY;
  if (area === 'burst3') {
    return Math.max(Math.abs(dx), Math.abs(dy)) <= 1;
  }
  return combatAreaOffsets(area, direction).some(([ox, oy]) => ox === dx && oy === dy);
}

export function isDirectionalCombatArea(area: CombatAreaId): boolean {
  return DIRECTIONAL_AREAS.has(area);
}

/** Face the primary pack target — waves and beams use this like Crystal needDirection. */
export function combatAreaDirection(
  focusX: number,
  focusY: number,
  originX = PLAYER_TILE.x,
  originY = PLAYER_TILE.y,
): number {
  const dx = focusX - originX;
  const dy = focusY - originY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? DIRECTION_EAST : DIRECTION_WEST;
  }
  return dy > 0 ? DIRECTION_SOUTH : DIRECTION_NORTH;
}

/** Melee ring around the player — used for caster-centered spells (exori / caldera). */
export function meleeSurroundSpots(cx: number = PLAYER_TILE.x, cy: number = PLAYER_TILE.y): Array<{ x: number; y: number }> {
  const spots: Array<{ x: number; y: number }> = [];
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      spots.push({ x: cx + ox, y: cy + oy });
    }
  }
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) <= 1) continue;
      spots.push({ x: cx + ox, y: cy + oy });
    }
  }
  return spots;
}
