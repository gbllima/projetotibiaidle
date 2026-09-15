import room from '../generated/thais-depot.json' with { type: 'json' };
import blockedIds from '../generated/thais-depot-blocked.json' with { type: 'json' };

/** The original Thais Depot cut, shared by the renderer and server movement. */
export interface CityPosition { x: number; y: number }
export const CITY_WIDTH = room.ground[0]!.length;
export const CITY_HEIGHT = room.ground.length;
export const CITY_SPAWN: CityPosition = { x: Math.floor(CITY_WIDTH / 2), y: Math.floor(CITY_HEIGHT / 2) };
// Keep the merchant one tile farther north, behind the wooden counter, so the
// counter does not cover almost the entire outfit.
export const CITY_MERCHANT: CityPosition = { x: 10, y: 5 };
export const CITY_STEP_MS = 320;
const blocked = new Set<number>(blockedIds);
export const cityTiles = room.ground.flatMap((row, y) => row.map((ground, x) => {
  const props = room.stack[y]?.[x] ?? [];
  return { x, y, ground, props,
    blocked: !ground || blocked.has(ground) || props.some(id => blocked.has(id))
      || (x === CITY_MERCHANT.x && y === CITY_MERCHANT.y),
  };
}));

export function cityWalkable(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < CITY_WIDTH && y < CITY_HEIGHT
    && cityTiles[y * CITY_WIDTH + x]?.blocked === false;
}

/** Cardinal BFS routes around the original depot walls and furniture. */
export function cityPath(from: CityPosition, to: CityPosition): CityPosition[] {
  if (!cityWalkable(to.x, to.y)) return [];
  const key = (p: CityPosition) => p.y * CITY_WIDTH + p.x;
  const queue = [from]; const previous = new Map<number, CityPosition | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (current.x === to.x && current.y === to.y) {
      const path: CityPosition[] = []; let cursor = current;
      while (previous.get(key(cursor))) { path.push(cursor); cursor = previous.get(key(cursor))!; }
      return path.reverse();
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (!cityWalkable(next.x, next.y) || previous.has(key(next))) continue;
      previous.set(key(next), current); queue.push(next);
    }
  }
  return [];
}
