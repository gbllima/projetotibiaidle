import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';

function parsedPartyIds(db: Database, ownerId: number): number[] {
  try {
    const value = JSON.parse(db.getWorld('party:' + ownerId) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

function stateFromRow(row: CharacterRow): CharacterState {
  return row.session
    ? (JSON.parse(row.session) as HuntSession).character
    : JSON.parse(row.state) as CharacterState;
}

/** Resolve the canonical saved principal without advancing time or changing the party. */
export function partyPrincipal(db: Database, member: CharacterRow): CharacterState {
  // A principal's own party record is authoritative and should win even if a
  // malformed legacy record also contains the same character.
  const ownIds = parsedPartyIds(db, member.id);
  if (ownIds.length > 1 && ownIds[0] === member.id && ownIds.includes(member.id)) {
    return stateFromRow(member);
  }

  for (const row of db.charactersForAccount(member.accountId)) {
    if (row.id === member.id) continue;
    const ids = parsedPartyIds(db, row.id);
    // Only accept canonical formations whose key owner is also the first
    // member. This ignores stale/legacy duplicate world-state records.
    if (ids.length > 1 && ids[0] === row.id && ids.includes(member.id)) {
      return stateFromRow(row);
    }
  }

  return stateFromRow(member);
}
