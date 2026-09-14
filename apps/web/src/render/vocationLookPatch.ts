import { VOCATION_LOOK } from './combat.js';

/**
 * Keep the renderer fallback aligned with the server's canonical class looks.
 * Real characters still use their saved appearance first; this only applies
 * when an appearance is missing and CombatScene falls back to vocationId.
 */
Object.assign(VOCATION_LOOK, {
  1: 130,
  2: 144,
  3: 129,
  4: 131,
  5: 130,
  6: 144,
  7: 129,
  8: 131,
  9: 146,
  10: 146,
});
