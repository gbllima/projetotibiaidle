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
  reinforcementQueue?: unknown[];
  /** Temporary credit injected only so the visible wave can open on schedule. */
  waveTimingCreditDebt?: number;
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
 * We temporarily advance only the credit needed for the first visible group.
 * Once those newly-created monsters enter the floor, the advance is converted
 * into negative spawn-credit debt. Later reinforcements therefore wait until
 * the calibrated cave budget has repaid the debt, preserving XP/hour and loot
 * balance while keeping the visual wave transition fixed.
 */
function primeWaveOpening(session: HuntSession): void {
  const managed = session as TimedReinforcementSession;
  if (managed.reinforcementReadyTick === undefined || session.active.length > 0) return;
  // Persisted legacy monsters have already consumed their budget; they can be
  // released from the queue without borrowing any new spawn credit.
  if ((managed.reinforcementQueue?.length ?? 0) > 0) return;

  const progress = waveProgress(session.totals.kills);
  if (progress.killed !== 0) return;

  const opening = Math.min(progress.size, openingVisibleLimit(managed, progress.waveIndex));
  const borrowed = Math.max(0, opening - session.spawnCredits);
  if (borrowed <= 0) return;
  session.spawnCredits += borrowed;
  managed.waveTimingCreditDebt = (managed.waveTimingCreditDebt ?? 0) + borrowed;
}

function settleOpeningDebt(
  session: HuntSession,
  waitingBefore: boolean,
  nextUidBefore: number,
  debtBefore: number,
): void {
  if (!waitingBefore || debtBefore <= 0 || session.nextUid <= nextUidBefore) return;
  const managed = session as TimedReinforcementSession;
  // Negative credit is intentional: combat.ts keeps accruing the calibrated
  // fractional budget each tick, and reinforcements cannot spawn until it is
  // positive again. This repays exactly the credit borrowed for the opening.
  session.spawnCredits -= debtBefore;
  managed.waveTimingCreditDebt = Math.max(0, (managed.waveTimingCreditDebt ?? 0) - debtBefore);
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
    const managed = session as TimedReinforcementSession;
    const waitingBefore = managed.reinforcementReadyTick !== undefined && session.active.length === 0;
    const debtBefore = managed.waveTimingCreditDebt ?? 0;
    const nextUidBefore = session.nextUid;

    const produced = advanceReinforcements(session, 1, {
      ...options,
      maxEvents: Math.max(0, maxEvents - events.length),
    });
    settleOpeningDebt(session, waitingBefore, nextUidBefore, debtBefore);

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
