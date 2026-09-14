import {
  addExperience, isBossHunt, layoutPackMonsters, PLAYER_TILE, TICK_MS,
  type ActiveMonster, type HuntSession,
} from '@tibia-idle/sim';
import { offlineCapHours, OFFLINE_GAP_MS, OFFLINE_EFFICIENCY, settle } from './settle.js';
import { applyPartyHealing } from './party-healing.js';

export interface PartySession {
  id: number;
  session: HuntSession;
  settledAt: number;
}

type PartyRuntimeEntry = PartySession & {
  result: ReturnType<typeof settle>;
  cursor: number;
  until: number;
  before: HuntSession['totals'];
  level: number;
};

type ReinforcementPartySession = HuntSession & {
  reinforcementPartySize?: number;
  reinforcementPartyIndex?: number;
};

/**
 * Visual party formation used by the hunt renderer: principal in the centre,
 * then the first two companions spread farther to the lower-left / lower-right.
 *
 * The server simulation is intentionally map-light, but using the same seats
 * gives us a deterministic definition of "nearest party member" when a hunter
 * dies and the creatures that were surrounding them need a new target.
 */
const PARTY_SEATS = [
  { x: PLAYER_TILE.x, y: PLAYER_TILE.y },
  { x: PLAYER_TILE.x - 3, y: PLAYER_TILE.y + 2 },
  { x: PLAYER_TILE.x + 3, y: PLAYER_TILE.y + 2 },
] as const;

function partySeat(index: number): { x: number; y: number } {
  return PARTY_SEATS[index] ?? {
    x: PLAYER_TILE.x + (index % 2 === 0 ? 3 : -3),
    y: PLAYER_TILE.y + 2 + Math.floor(index / 2),
  };
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function monsterWorldTile(monster: ActiveMonster, ownerIndex: number): { x: number; y: number } {
  const owner = partySeat(ownerIndex);
  return {
    x: owner.x + (monster.tileX - PLAYER_TILE.x),
    y: owner.y + (monster.tileY - PLAYER_TILE.y),
  };
}

function nearestLivingRecipient(
  entries: PartyRuntimeEntry[],
  sourceIndex: number,
  monster: ActiveMonster,
): { entry: PartyRuntimeEntry; index: number } | null {
  const source = entries[sourceIndex];
  if (!source) return null;
  const world = monsterWorldTile(monster, sourceIndex);

  const candidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index !== sourceIndex
      && entry.session.huntId === source.session.huntId
      && entry.session.status === 'active'
      && entry.session.character.health > 0)
    .sort((left, right) => {
      const leftSeat = partySeat(left.index);
      const rightSeat = partySeat(right.index);
      const leftDistance = chebyshev(world.x, world.y, leftSeat.x, leftSeat.y);
      const rightDistance = chebyshev(world.x, world.y, rightSeat.x, rightSeat.y);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      // Equal distance: keep the pressure balanced instead of piling every
      // transferred creature onto the same survivor.
      if (left.entry.session.active.length !== right.entry.session.active.length) {
        return left.entry.session.active.length - right.entry.session.active.length;
      }
      return left.index - right.index;
    });

  return candidates[0] ?? null;
}

/**
 * A configured party represents one fight on screen even though each character
 * keeps an independent persisted HuntSession. When one member actually dies,
 * move their still-living creatures into the nearest surviving member's session
 * so those monsters continue attacking instead of vanishing with the dead
 * session.
 *
 * Dedicated boss instances remain isolated: moving a second boss into a session
 * that completes on the first boss death would leave an unfinishable encounter.
 */
function retargetMonstersFromDeaths(
  entries: PartyRuntimeEntry[],
  statusesBeforeTick: Map<number, HuntSession['status']>,
): void {
  const relayout = new Set<HuntSession>();

  entries.forEach((source, sourceIndex) => {
    if (statusesBeforeTick.get(source.id) !== 'active' || source.session.status !== 'died') return;
    if (source.session.active.length === 0 || isBossHunt(source.session.huntId)) return;

    const remaining = [...source.session.active];
    source.session.active = [];

    for (const monster of remaining) {
      const target = nearestLivingRecipient(entries, sourceIndex, monster);
      if (!target) {
        // Everybody else is also down: leave the creature with the dead session
        // and let normal hunt finalisation remove it.
        source.session.active.push(monster);
        continue;
      }

      const moved: ActiveMonster = {
        ...monster,
        uid: target.entry.session.nextUid++,
        attackCooldowns: [...monster.attackCooldowns],
      };
      target.entry.session.active.push(moved);
      relayout.add(target.entry.session);
    }
  });

  // Re-seat imported monsters around their new target. This also keeps the
  // server snapshot aligned with the viewport's tile-based AoE calculations.
  for (const session of relayout) layoutPackMonsters(session.active);
}

/** Advance on one clock and distribute only monster rewards at the instant of a kill. */
export function settleParty(sessions: PartySession[], now: number, remainderCursor = 0) {
  const entries: PartyRuntimeEntry[] = sessions.map((member, partyIndex) => {
    const { session, settledAt } = member;
    session.partyMembers = [];

    // The simulator keeps each character in its own persisted HuntSession, while
    // the client renders all of them on one floor. Tell the reinforcement layer
    // how many sessions share that floor so the 3-7 enemy limit is distributed
    // across the whole party instead of being repeated for every character.
    const reinforcement = session as ReinforcementPartySession;
    reinforcement.reinforcementPartySize = Math.max(1, sessions.length);
    reinforcement.reinforcementPartyIndex = partyIndex;

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

    const statusesBeforeTick = new Map(entries.map((entry) => [entry.id, entry.session.status]));

    // Party support happens before each hunter's own combat tick. This lets the
    // Helper's "Priorizar minha cura" reserve the shared healing cooldown for
    // self-healing when necessary; otherwise exura sio can claim it for an ally.
    for (const support of applyPartyHealing(entries, next)) {
      const healer = entries.find((entry) => entry.id === support.healerId);
      if (healer) healer.result.events = [...healer.result.events, support.event].slice(-24);
    }

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

    // Death is resolved only after every member has processed this timestamp, so
    // a creature never gets an extra same-tick attack merely because its new
    // target happened to be later in the array.
    retargetMonstersFromDeaths(entries, statusesBeforeTick);
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
