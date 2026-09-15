import type { FastifyInstance } from 'fastify';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';

function currentState(row: CharacterRow): CharacterState {
  if (row.session) {
    try {
      return (JSON.parse(row.session) as HuntSession).character;
    } catch {
      // Fall back to the persisted character state below.
    }
  }
  return JSON.parse(row.state) as CharacterState;
}

export function activeVipVisuals(db: Database, now = Date.now()): Array<{ id: number; name: string }> {
  return db.allCharacters().flatMap((row) => {
    const state = currentState(row);
    if (!state.premium || (state.vipUntil ?? 0) <= now) return [];
    return [{ id: row.id, name: state.name }];
  });
}

/**
 * Public read-only presentation data. Character names are already visible in
 * the city, hunts, rankings and chat; this endpoint only tells the renderer
 * which of those visible names currently has an active VIP badge/effect.
 */
export function registerVipVisualRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/vip-visuals', async () => ({ players: activeVipVisuals(db) }));
}
