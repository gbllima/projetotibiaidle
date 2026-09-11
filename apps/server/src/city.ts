import { CITY_SPAWN, CITY_STEP_MS, cityWalkable, type CityPosition } from '@tibia-idle/data';
import type { Database } from './db.js';

type Presence = CityPosition & { seen: number; moved: number };
const cities = new WeakMap<Database, Map<number, Presence>>();
function positions(db: Database) {
  let map = cities.get(db);
  if (!map) { map = new Map(); cities.set(db, map); }
  return map;
}
export function cityPresence(db: Database, id: number): Presence | undefined {
  const entry = positions(db).get(id);
  return entry && Date.now() - entry.seen < 15_000 ? entry : undefined;
}
export function enterCity(db: Database, id: number): CityPosition {
  const map = positions(db);
  // Prune abandoned sessions while preserving active visitors' positions.
  for (const [key, value] of map) if (Date.now() - value.seen >= 15_000) map.delete(key);
  const entry = map.get(id) ?? { ...CITY_SPAWN, moved: 0, seen: 0 };
  entry.seen = Date.now(); map.set(id, entry);
  return { x: entry.x, y: entry.y };
}
export function moveCity(db: Database, id: number, target: CityPosition): { position: CityPosition; accepted: boolean } {
  enterCity(db, id);
  const entry = positions(db).get(id)!;
  const accepted = cityWalkable(target.x, target.y)
    && Math.abs(target.x - entry.x) + Math.abs(target.y - entry.y) === 1
    && Date.now() - entry.moved >= CITY_STEP_MS - 20;
  if (accepted) { entry.x = target.x; entry.y = target.y; entry.moved = Date.now(); }
  return { position: { x: entry.x, y: entry.y }, accepted };
}
