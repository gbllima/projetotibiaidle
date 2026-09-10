import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';

/** Resolve the saved principal without advancing time or changing the party. */
export function partyPrincipal(db: Database, member: CharacterRow): CharacterState {
  let primary = member;
  for (const row of db.charactersForAccount(member.accountId)) {
    try {
      const ids = JSON.parse(db.getWorld('party:' + row.id) ?? '[]') as unknown;
      if (Array.isArray(ids) && ids.length > 1 && ids.includes(member.id)) { primary = row; break; }
    } catch { /* Ignore malformed legacy formations. */ }
  }
  return primary.session ? (JSON.parse(primary.session) as HuntSession).character : JSON.parse(primary.state) as CharacterState;
}
