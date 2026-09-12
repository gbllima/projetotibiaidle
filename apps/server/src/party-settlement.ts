import { addExperience, TICK_MS, type HuntSession } from '@tibia-idle/sim';
import { offlineCapHours, OFFLINE_GAP_MS, OFFLINE_EFFICIENCY, settle } from './settle.js';

export interface PartySession {
  id: number;
  session: HuntSession;
  settledAt: number;
}

/** Advance on one clock and distribute only monster rewards at the instant of a kill. */
export function settleParty(sessions: PartySession[], now: number, remainderCursor = 0) {
  const entries = sessions.map((member) => {
    const { session, settledAt } = member;
    session.partyMembers = [];
    const elapsed = Math.max(0, now - settledAt);
    const cap = offlineCapHours(session.character, now) * 3_600_000;
    const result = settle(session, settledAt, settledAt);
    result.offline = elapsed > OFFLINE_GAP_MS;
    result.efficiency = result.offline ? OFFLINE_EFFICIENCY : 1;
    result.capHours = cap / 3_600_000;
    result.discardedSeconds = Math.round(Math.max(0, elapsed - cap) / 1000);
    return { ...member, result, cursor: settledAt, until: settledAt + Math.min(elapsed, cap),
      before: { ...session.totals }, level: session.character.level };
  });
  while (true) {
    const next = Math.min(...entries.filter((entry) => entry.session.status === 'active'
      && entry.cursor + TICK_MS <= entry.until).map((entry) => entry.cursor + TICK_MS));
    if (!Number.isFinite(next)) break;
    for (const entry of entries) {
      if (entry.session.status !== 'active' || entry.cursor + TICK_MS !== next || next > entry.until) continue;
      const step = settle(entry.session, entry.cursor, next, {
        offline: entry.result.offline,
        maxEvents: 24,
        awardKillExperience: (source, amount, emit) => {
          const recipients = entries.filter((other) => other.session.huntId === source.huntId
            && (other.session === source || (other.session.status === 'active' && other.session.character.health > 0))
            && (other.session.startedAt ?? other.settledAt) <= next && next <= other.until);
          if (recipients.length === 0) return;

          // Keep party members exactly tied in XP instead of assigning indivisible
          // remainder points to one member at a time. Any fraction that cannot yet
          // be shared equally stays in this tiny pool and is released on later kills.
          // Existing persisted cursors from the old rotating-remainder system are
          // safely reduced to a valid pending remainder on first use.
          const pending = ((remainderCursor % recipients.length) + recipients.length) % recipients.length;
          const pooled = amount + pending;
          const share = Math.floor(pooled / recipients.length);
          remainderCursor = pooled % recipients.length;

          if (share <= 0) return;
          for (const recipient of recipients) {
            recipient.session.totals.experience += share;
            const levelUp = addExperience(recipient.session.character, share);
            if (levelUp.levels > 0) emit({ tick: source.tick, type: 'level_up', level: levelUp.newLevel, actorId: recipient.id });
          }
        },
      });
      entry.cursor = next;
      entry.result.events = [...entry.result.events, ...step.events].slice(-24);
    }
  }
  for (const entry of entries) {
    const { session, result, before } = entry;
    result.elapsedSeconds = Math.round((entry.cursor - entry.settledAt) / 1000);
    result.stoppedBecause = session.status === 'active' ? null : session.status;
    result.deathPenalty = session.lastDeathPenalty ?? null;
    result.delta = { experience: session.totals.experience - before.experience,
      kills: session.totals.kills - before.kills, lootValue: session.totals.lootValue - before.lootValue,
      supplyValue: session.totals.supplyValue - before.supplyValue, levels: session.character.level - entry.level };
  }
  return { entries, remainderCursor };
}
