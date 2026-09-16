import { randomInt } from 'node:crypto';
import { pouchHasRoom, type HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';

export interface MultiplayerLootBaseline {
  huntId: string;
  lootByItem: Record<number, number>;
}

type Recipient = {
  id: number;
  row: CharacterRow;
  session: HuntSession;
};

type PickIndex = (upperExclusive: number) => number;

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  } catch {
    return [];
  }
}

function multiplayerPartyIds(db: Database, characterId: number): number[] {
  const leaderId = Number(db.getWorld(`mp-member:${characterId}`) ?? 0);
  if (!Number.isInteger(leaderId) || leaderId <= 0) return [];
  const ids = parseIds(db.getWorld(`mp-party:${leaderId}`));
  if (ids.length < 2 || ids[0] !== leaderId || !ids.includes(characterId)) return [];
  return ids;
}

export function captureMultiplayerLootBaseline(db: Database, characterId: number): MultiplayerLootBaseline | null {
  const row = db.findCharacter(characterId);
  if (!row?.session) return null;
  try {
    const session = JSON.parse(row.session) as HuntSession;
    if (session.status !== 'active') return null;
    return {
      huntId: session.huntId,
      lootByItem: { ...(session.totals.lootByItem ?? {}) },
    };
  } catch {
    return null;
  }
}

function recipientSessions(
  db: Database,
  sourceCharacterId: number,
  sourceSession: HuntSession,
): Recipient[] {
  const ids = multiplayerPartyIds(db, sourceCharacterId);
  if (ids.length < 2) return [];

  return ids.flatMap((id) => {
    const row = db.findCharacter(id);
    if (!row) return [];

    if (id === sourceCharacterId) {
      if (sourceSession.status !== 'active') return [];
      return [{ id, row, session: sourceSession }];
    }

    if (!row.session) return [];
    try {
      const session = JSON.parse(row.session) as HuntSession;
      if (session.status !== 'active' || session.huntId !== sourceSession.huntId) return [];
      if (session.character.health <= 0) return [];
      return [{ id, row, session }];
    } catch {
      return [];
    }
  });
}

function safeIndex(raw: number, length: number): number {
  if (length <= 1) return 0;
  if (!Number.isFinite(raw)) return 0;
  const value = Math.trunc(raw);
  return ((value % length) + length) % length;
}

/**
 * Multiplayer sessions are settled independently because every member belongs to
 * a different account. The simulator therefore places a rolled item in the
 * killer's pouch first. After that authoritative settlement, move only the newly
 * created physical pouch items to a random living member in the same shared hunt.
 *
 * Existing pouch contents are never touched. Money/junk auto-sold by the simulator
 * is intentionally left as gold because it no longer exists as a physical item.
 */
export function redistributeMultiplayerLoot(
  db: Database,
  sourceCharacterId: number,
  sourceSession: HuntSession | null,
  baseline: MultiplayerLootBaseline | null,
  pickIndex: PickIndex = (upperExclusive) => randomInt(upperExclusive),
): number {
  if (!sourceSession || !baseline || sourceSession.huntId !== baseline.huntId) return 0;

  const recipients = recipientSessions(db, sourceCharacterId, sourceSession);
  if (recipients.length < 2) return 0;
  const source = recipients.find((recipient) => recipient.id === sourceCharacterId);
  if (!source) return 0;

  const touched = new Map<number, Recipient>();
  let moved = 0;

  for (const [rawItemId, afterCount] of Object.entries(sourceSession.totals.lootByItem ?? {})) {
    const itemId = Number(rawItemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const beforeCount = Math.max(0, Number(baseline.lootByItem[itemId] ?? 0));
    const gained = Math.max(0, Math.floor(Number(afterCount) - beforeCount));
    if (gained <= 0) continue;

    // Remove only the newly rolled units, then award each unit independently.
    // This keeps old pouch contents exactly where they were before the tick.
    const keptOnSource = Math.max(0, Number(afterCount) - gained);
    if (keptOnSource > 0) sourceSession.totals.lootByItem[itemId] = keptOnSource;
    else delete sourceSession.totals.lootByItem[itemId];

    for (let unit = 0; unit < gained; unit += 1) {
      const eligible = recipients.filter((recipient) => pouchHasRoom(recipient.session, itemId));
      const pool = eligible.length > 0 ? eligible : [source];
      const chosen = pool[safeIndex(pickIndex(pool.length), pool.length)] ?? source;
      chosen.session.totals.lootByItem[itemId] = (chosen.session.totals.lootByItem[itemId] ?? 0) + 1;
      if (chosen.id !== sourceCharacterId) {
        moved += 1;
        touched.set(chosen.id, chosen);
      }
    }
  }

  if (moved <= 0) return 0;

  // loadCharacter already advanced/persisted the source clock. Preserve that
  // settledAt value while replacing only its adjusted session payload.
  const freshSource = db.findCharacter(sourceCharacterId);
  if (freshSource) {
    db.saveCharacter(
      freshSource.id,
      freshSource.state,
      JSON.stringify(sourceSession),
      freshSource.settledAt,
    );
  }

  // Recipients were not advanced here. Keep their original settledAt so their
  // own next settlement still simulates every pending combat tick.
  for (const recipient of touched.values()) {
    const fresh = db.findCharacter(recipient.id);
    if (!fresh?.session) continue;
    db.saveCharacter(
      fresh.id,
      fresh.state,
      JSON.stringify(recipient.session),
      fresh.settledAt,
    );
  }

  return moved;
}
