import { randomBytes } from 'node:crypto';
import { beginHunt, DEFAULT_HUNT_HOURS } from './settle.js';
import type { Database } from './db.js';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import { isBossHunt } from '@tibia-idle/sim';

interface Loaded {
  row: { id: number };
  character: CharacterState;
  session: HuntSession | null;
}

export let HUNT_CAP = 8;

export function setHuntCap(cap: number): void {
  HUNT_CAP = Math.max(1, cap);
}

function persist(db: Database, loaded: Loaded, now: number): void {
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
}

export function tryStartOrQueue(
  db: Database,
  loaded: Loaded,
  huntId: string,
  now: number,
  hours?: number,
): 'started' | 'queued' {
  db.dequeueHunt(loaded.row.id);
  if (!isBossHunt(huntId) && db.huntOccupancy(huntId) >= HUNT_CAP) {
    db.enqueueHunt(huntId, loaded.row.id);
    persist(db, loaded, now);
    return 'queued';
  }
  const seed = BigInt(`0x${randomBytes(8).toString('hex')}`);
  loaded.session = beginHunt(loaded.character, huntId, seed, { hours: hours ?? DEFAULT_HUNT_HOURS });
  if (!isBossHunt(huntId)) db.occupyHunt(huntId, loaded.row.id);
  persist(db, loaded, now);
  return 'started';
}

export function releaseAndPromote(db: Database, characterId: number, now: number): void {
  const huntId = db.releaseHunt(characterId) ?? db.dequeueHunt(characterId);
  if (huntId) promoteHunt(db, huntId, now);
}

export function promoteHunt(db: Database, huntId: string, now: number): void {
  while (db.huntOccupancy(huntId) < HUNT_CAP) {
    const nextId = db.nextQueued(huntId);
    if (nextId === null) break;
    db.dequeueHunt(nextId);
    const row = db.findCharacter(nextId);
    if (!row) continue;
    const session = row.session ? JSON.parse(row.session) : null;
    if (session?.status === 'active' && session.huntId === huntId) {
      db.occupyHunt(huntId, nextId);
      db.saveCharacter(nextId, row.state, JSON.stringify(session), now);
      continue;
    }
    try {
      const character = JSON.parse(row.state);
      const seed = BigInt(`0x${randomBytes(8).toString('hex')}`);
      const started = beginHunt(character, huntId, seed, { hours: DEFAULT_HUNT_HOURS });
      db.occupyHunt(huntId, nextId);
      db.saveCharacter(nextId, JSON.stringify(started.character), JSON.stringify(started), now);
    } catch {
      // Cannot afford or cannot survive: skip this waiter.
    }
  }
}
