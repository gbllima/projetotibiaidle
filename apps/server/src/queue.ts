import { partyPrincipal } from './party-access.js';
import { randomBytes } from 'node:crypto';
import { beginHunt, DEFAULT_HUNT_HOURS, GameError } from './settle.js';
import { recommendedLevelFor } from '@tibia-idle/data';
import type { Database } from './db.js';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import { isBossHunt, getBossEncounterForHunt } from '@tibia-idle/sim';

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

function queueHoursKey(characterId: number): string {
  return `hunt-queue-hours:${characterId}`;
}

function normaliseHours(hours?: number): number {
  return Number.isFinite(hours) && Number(hours) > 0 ? Number(hours) : DEFAULT_HUNT_HOURS;
}

function queuedHours(db: Database, characterId: number): number {
  const stored = Number(db.getWorld(queueHoursKey(characterId)) ?? DEFAULT_HUNT_HOURS);
  return normaliseHours(stored);
}

function clearQueuedHours(db: Database, characterId: number): void {
  db.setWorld(queueHoursKey(characterId), '');
}

export function tryStartOrQueue(
  db: Database,
  loaded: Loaded,
  huntId: string,
  now: number,
  hours?: number,
): 'started' | 'queued' {
  const row = db.findCharacter(loaded.row.id);
  if (!row) throw new GameError('Personagem não encontrado.', 404);
  const principal = partyPrincipal(db, row);
  const minimum = isBossHunt(huntId)
    ? getBossEncounterForHunt(huntId)?.minLevel
    : recommendedLevelFor(huntId, principal.vocationId) ?? undefined;
  if (minimum === undefined || principal.level < minimum) {
    throw new GameError(`Conteúdo bloqueado: o personagem principal precisa ser nível ${minimum ?? '?'} ou maior.`, 422);
  }

  db.dequeueHunt(loaded.row.id);
  clearQueuedHours(db, loaded.row.id);
  const requestedHours = normaliseHours(hours);
  if (!isBossHunt(huntId) && db.huntOccupancy(huntId) >= HUNT_CAP) {
    db.enqueueHunt(huntId, loaded.row.id);
    db.setWorld(queueHoursKey(loaded.row.id), String(requestedHours));
    persist(db, loaded, now);
    return 'queued';
  }

  const seed = BigInt(`0x${randomBytes(8).toString('hex')}`);
  loaded.session = beginHunt(loaded.character, huntId, seed, {
    hours: requestedHours,
    principal: partyPrincipal(db, db.findCharacter(loaded.row.id)!),
  });
  if (!isBossHunt(huntId)) db.occupyHunt(huntId, loaded.row.id);
  persist(db, loaded, now);
  return 'started';
}

export function releaseAndPromote(db: Database, characterId: number, now: number): void {
  const occupiedHunt = db.releaseHunt(characterId);
  const queuedHunt = occupiedHunt ? null : db.dequeueHunt(characterId);
  if (queuedHunt) clearQueuedHours(db, characterId);
  const huntId = occupiedHunt ?? queuedHunt;
  if (huntId) promoteHunt(db, huntId, now);
}

export function promoteHunt(db: Database, huntId: string, now: number): void {
  while (db.huntOccupancy(huntId) < HUNT_CAP) {
    const nextId = db.nextQueued(huntId);
    if (nextId === null) break;
    const hours = queuedHours(db, nextId);
    db.dequeueHunt(nextId);
    clearQueuedHours(db, nextId);
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
      const started = beginHunt(character, huntId, seed, {
        hours,
        principal: partyPrincipal(db, row),
      });
      db.occupyHunt(huntId, nextId);
      db.saveCharacter(nextId, JSON.stringify(started.character), JSON.stringify(started), now);
    } catch {
      // Cannot afford, cannot survive or no longer meets the principal-level requirement: skip this waiter.
    }
  }
}
