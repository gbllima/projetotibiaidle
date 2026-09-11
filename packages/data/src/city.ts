/** Shared city geometry: rendering and server movement use the same tiles. */
export interface CityPosition { x: number; y: number }
export const CITY_WIDTH = 34;
export const CITY_HEIGHT = 28;
export const CITY_SPAWN: CityPosition = { x: 20, y: 10 };
export const CITY_MERCHANT: CityPosition = { x: 17, y: 7 };
export const CITY_STEP_MS = 320;
export const cityTiles: Array<{ x: number; y: number; ground: number; props: number[]; blocked: boolean }> = [];

for (let y = 0; y < CITY_HEIGHT; y++) for (let x = 0; x < CITY_WIDTH; x++) {
  const tile = { x, y, ground: 870, props: [] as number[], blocked: false };
  const hall = x >= 14 && x <= 31 && y >= 4 && y <= 21;
  const garden = x <= 3 || y <= 2 || y >= 25;
  tile.ground = hall ? 410 : garden ? 4526 : 870;
  const wall = hall && (y === 4 || y === 21 || x === 31 || (x === 14 && !(y >= 12 && y <= 14)));
  if (wall) { tile.props.push(y === 4 || y === 21 ? 1084 : 1081); tile.blocked = true; }
  // Depot booths along the north and south sides of the main hall.
  if (hall && x >= 21 && x <= 29 && x % 3 !== 2 && (y === 7 || y === 19)) {
    tile.props.push(x % 3 === 0 ? 2310 : 2311); tile.blocked = true;
  }
  if (hall && x >= 21 && x <= 29 && x % 3 === 0 && (y === 6 || y === 20)) {
    tile.props.push(30620); tile.blocked = true;
  }
  // Merchant counter; the NPC stands behind it.
  if (x >= 16 && x <= 19 && y === 8) { tile.props.push(x % 2 === 0 ? 2312 : 2313); tile.blocked = true; }
  if (x === CITY_MERCHANT.x && y === CITY_MERCHANT.y) tile.blocked = true;
  // Two ornamental pools leave a wide north/south avenue and access to the depot.
  if (x >= 6 && x <= 10 && ((y >= 5 && y <= 9) || (y >= 18 && y <= 22))) {
    tile.ground = 629; tile.blocked = true;
    if (x === 6 || x === 10 || y === 5 || y === 9 || y === 18 || y === 22) tile.ground = 104;
    if (x === 8 && (y === 7 || y === 20)) tile.props.push(7592);
  }
  if ((x === 3 || x === 32) && y % 5 === 0) { tile.props.push(30620); tile.blocked = true; }
  if ((y === 5 || y === 20) && (x === 15 || x === 30)) { tile.props.push(2921); tile.blocked = true; }
  if (x === 0 || y === 0 || x === CITY_WIDTH - 1 || y === CITY_HEIGHT - 1) tile.blocked = true;
  cityTiles.push(tile);
}

export function cityWalkable(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < CITY_WIDTH && y < CITY_HEIGHT
    && cityTiles[y * CITY_WIDTH + x]?.blocked === false;
}

/** Cardinal BFS avoids cutting through wall corners and routes around pools. */
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
