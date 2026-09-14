import { startSession as startReinforcementSession } from './waveReinforcements.js';
import type { CharacterState, HuntSession } from './types.js';

const STARTER_HUNT_ID = 'venore-rotworm-cave';
const STARTER_MONSTER_ID = 'rotworm';
const STARTER_FAST_KILLS = 3;
const STARTER_MAX_LEVEL = 10;
const STARTER_HEALTH_MULTIPLIER = 0.18;

/**
 * New characters need an early payoff before the normal idle pacing takes over.
 * Only the first three lifetime Rotworms, and only inside the starter Venore cave,
 * get reduced encounter health. XP, loot, monster data and every later spawn stay
 * untouched, so the normal hunt economy remains authoritative after onboarding.
 */
function applyStarterCombatPacing(session: HuntSession): void {
  if (session.huntId !== STARTER_HUNT_ID || session.character.level > STARTER_MAX_LEVEL) return;

  const lifetimeKills = session.character.bestiary?.[STARTER_MONSTER_ID] ?? 0;
  let remainingFastKills = Math.max(0, STARTER_FAST_KILLS - lifetimeKills);
  if (remainingFastKills === 0) return;

  for (const monster of session.active) {
    if (remainingFastKills === 0) break;
    if (monster.monsterId !== STARTER_MONSTER_ID) continue;

    const pacedHealth = Math.max(1, Math.round(monster.maxHealth * STARTER_HEALTH_MULTIPLIER));
    monster.maxHealth = pacedHealth;
    monster.health = Math.min(monster.health, pacedHealth);
    remainingFastKills -= 1;
  }
}

export function startSession(
  character: CharacterState,
  huntId: string,
  seed: number | bigint,
): HuntSession {
  const session = startReinforcementSession(character, huntId, seed);
  applyStarterCombatPacing(session);
  return session;
}
