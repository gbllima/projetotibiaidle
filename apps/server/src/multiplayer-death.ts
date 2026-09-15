import {
  WAVE_CYCLE_KILLS,
  WAVES_TOTAL,
  deriveStats,
  waveProgress,
  type HuntSession,
} from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';

/** Runtime-only state persisted inside the hunt session JSON. */
export type MultiplayerCombatSession = HuntSession & {
  multiplayerDown?: boolean;
  /** Shared completed-wave counter observed when this player fell. */
  multiplayerDownAtWave?: number;
  /** Last shared completed-wave counter seen while this member was alive. */
  multiplayerLastSharedWave?: number;
  reinforcementQueue?: unknown[];
  reinforcementReadyTick?: number;
  nextWaveAtTick?: number;
  waveTimingCreditDebt?: number;
};

export function multiplayerSessionFromRow(row: CharacterRow): MultiplayerCombatSession | null {
  if (!row.session) return null;
  try {
    return JSON.parse(row.session) as MultiplayerCombatSession;
  } catch {
    return null;
  }
}

export function isMultiplayerDown(session: HuntSession | null | undefined): boolean {
  return Boolean(session && (session as MultiplayerCombatSession).multiplayerDown);
}

function sharedWaveCounter(sharedKills: number): number {
  const progress = waveProgress(sharedKills);
  return Math.floor(Math.max(0, sharedKills) / WAVE_CYCLE_KILLS) * WAVES_TOTAL + progress.waveIndex;
}

/**
 * Party Multiplayer death rule:
 * - the fallen member stays at 0 HP for the rest of the current shared wave;
 * - the member does not simulate combat while down;
 * - when the party enters the next shared wave, the member returns at 50% HP/MP;
 * - if everybody falls, there is no next wave, so the normal death/end-hunt path
 *   is restored for every member instead of leaving the party permanently stuck.
 *
 * This function intentionally runs from the live presentation bridge. Every
 * browser sees the same persisted flags, so the corpse and revive state are
 * authoritative rather than a client-only animation.
 */
export function synchronizeMultiplayerRevives(
  db: Database,
  memberIds: readonly number[],
  characterId: number,
  now = Date.now(),
): void {
  if (memberIds.length < 2) return;

  const entries = memberIds.flatMap((id) => {
    const row = db.findCharacter(id);
    if (!row) return [];
    const session = multiplayerSessionFromRow(row);
    return session ? [{ row, session }] : [];
  });
  if (entries.length < 2) return;

  const current = entries.find((entry) => entry.row.id === characterId);
  const huntId = current?.session.huntId ?? entries[0]?.session.huntId;
  if (!huntId) return;
  const group = entries.filter((entry) => entry.session.huntId === huntId);
  if (group.length < 2) return;

  const sharedKills = group.reduce((sum, entry) => sum + Math.max(0, entry.session.totals.kills), 0);
  const sharedWave = sharedWaveCounter(sharedKills);
  let living = group.filter((entry) => (
    entry.session.status === 'active'
    && !entry.session.multiplayerDown
    && entry.session.character.health > 0
  ));
  const downed = group.filter((entry) => entry.session.multiplayerDown);

  // If the entire real multiplayer party died, a next wave can never be
  // completed. Hand the sessions back to the normal death/end-hunt flow.
  if (downed.length > 0 && living.length === 0 && downed.length === group.length) {
    for (const entry of downed) {
      entry.session.status = 'died';
      db.saveCharacter(entry.row.id, entry.row.state, JSON.stringify(entry.session), now);
    }
    return;
  }

  for (const entry of group) {
    const session = entry.session;
    if (session.multiplayerDown) {
      const downAt = session.multiplayerDownAtWave
        ?? session.multiplayerLastSharedWave
        ?? sharedWave;
      let changed = false;
      if (session.multiplayerDownAtWave === undefined) {
        session.multiplayerDownAtWave = downAt;
        changed = true;
      }

      if (living.length > 0 && sharedWave > downAt) {
        const stats = deriveStats(session.character);
        session.multiplayerDown = false;
        session.multiplayerDownAtWave = undefined;
        session.multiplayerLastSharedWave = sharedWave;
        session.character.health = Math.max(1, Math.round(stats.maxHealth * 0.5));
        session.character.mana = Math.max(0, Math.round(stats.maxMana * 0.5));
        session.active = [];
        session.reinforcementQueue = [];
        session.reinforcementReadyTick = undefined;
        session.nextWaveAtTick = undefined;
        session.waveTimingCreditDebt = 0;
        session.playerAttackCooldown = 0;
        session.lastDeathPenalty = undefined;
        session.status = 'active';
        // Skip catch-up for the seconds spent as a corpse. Combat resumes from
        // this exact live moment at the beginning of the new wave.
        db.saveCharacter(entry.row.id, entry.row.state, JSON.stringify(session), now);
        living = [...living, entry];
        continue;
      }

      if (changed) {
        db.saveCharacter(entry.row.id, entry.row.state, JSON.stringify(session), entry.row.settledAt);
      }
      continue;
    }

    if (session.status === 'active' && session.character.health > 0 && session.multiplayerLastSharedWave !== sharedWave) {
      session.multiplayerLastSharedWave = sharedWave;
      db.saveCharacter(entry.row.id, entry.row.state, JSON.stringify(session), entry.row.settledAt);
    }
  }
}
