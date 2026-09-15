import {
  advance as advanceReinforcements,
  waveActiveLimit,
  WAVE_ACTIVE_LIMIT,
} from './waveReinforcements.js';
import { isBossWave, waveProgress } from './waves.js';
import type { AdvanceOptions } from './combat.js';
import type { HuntSession, SimEvent } from './types.js';

type TimedReinforcementSession = HuntSession & {
  reinforcementReadyTick?: number;
  reinforcementPartySize?: number;
  reinforcementPartyIndex?: number;
};

/**
 * Number of monsters this persisted session is allowed to place on the shared
 * floor when a new wave opens. This mirrors waveReinforcements' party split.
 */
function openingVisibleLimit(session: TimedReinforcementSession, waveIndex: number): number {
  const globalLimit = waveActiveLimit(waveIndex);
  const partySize = Math.max(1, Math.trunc(session.reinforcementPartySize ?? 1));
  if (partySize <= 1 || isBossWave(waveIndex)) return globalLimit;

  const index = Math.max(0, Math.min(partySize - 1, Math.trunc(session.reinforcementPartyIndex ?? 0)));
  const sharedTotal = Math.max(globalLimit, partySize);
  const base = Math.floor(sharedTotal / partySize);
  const remainder = sharedTotal % partySize;
  return Math.max(1, base + (index < remainder ? 1 : 0));
}

/**
 * The reinforcement layer deliberately uses spawn credits to pace creatures
 * that replace kills inside an already-open wave. Those credits must not extend
 * the empty-floor transition between waves: normal waves open after exactly 3s
 * and the skull wave after exactly 5s.
 *
 * Pre-fund only the first visible group while the transition timer is active.
 * The opening consumes this credit immediately, leaving later reinforcements on
 * the normal calibrated spawn budget.
 */
function primeWaveOpening(session: HuntSession): void {
  const managed = session as TimedReinforcementSession;
  if (managed.reinforcementReadyTick === undefined || session.active.length > 0) return;

  const progress = waveProgress(session.totals.kills);
  if (progress.killed !== 0) return;

  const opening = Math.min(progress.size, openingVisibleLimit(managed, progress.waveIndex));
  session.spawnCredits = Math.max(session.spawnCredits, opening);
}

/**
 * Public simulation entry point. Run reinforcement combat one tick at a time so
 * a wave transition created in the middle of a long/offline advance receives its
 * opening credit immediately, independent of how callers chunk time.
 */
export function advance(session: HuntSession, ticks: number, options: AdvanceOptions = {}): SimEvent[] {
  if (ticks <= 0) return advanceReinforcements(session, ticks, options);

  const maxEvents = options.maxEvents ?? 5000;
  const events: SimEvent[] = [];

  for (let step = 0; step < ticks && session.status === 'active'; step += 1) {
    primeWaveOpening(session);
    const produced = advanceReinforcements(session, 1, {
      ...options,
      maxEvents: Math.max(0, maxEvents - events.length),
    });
    for (const event of produced) {
      if (events.length < maxEvents) events.push(event);
    }
    // If the last kill advanced the wave during this tick, the reinforcement
    // wrapper has just created its 3s/5s timer. Prime the future opening now.
    primeWaveOpening(session);
  }

  return events;
}

export { waveActiveLimit, WAVE_ACTIVE_LIMIT };
