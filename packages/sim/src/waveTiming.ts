import {
  advance as advanceReinforcements,
  waveActiveLimit,
  WAVE_ACTIVE_LIMIT,
} from './waveReinforcements.js';
import type { AdvanceOptions } from './combat.js';
import type { HuntSession, SimEvent } from './types.js';

/**
 * Public wave entry point.
 *
 * Wave timing is now owned entirely by waveReinforcements: a cleared normal
 * wave waits exactly 3 seconds and the skull wave waits 5 seconds. Reinforcements
 * inside an already-open wave are visual combatants and may refill immediately;
 * the simulator keeps the zone's reward budget separate from that visual flow.
 *
 * Keeping this small wrapper preserves the public import used by the rest of the
 * app without re-introducing the old negative spawn-credit debt that could leave
 * a party staring at an empty Wave 2 for a long time.
 */
export function advance(session: HuntSession, ticks: number, options: AdvanceOptions = {}): SimEvent[] {
  return advanceReinforcements(session, ticks, options);
}

export { waveActiveLimit, WAVE_ACTIVE_LIMIT };
