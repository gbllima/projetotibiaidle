import type { CombatType } from '@tibia-idle/data';
import { TICK_MS, type ActiveCondition, type ConditionId, type HuntSession, type SimEvent } from './types.js';

/**
 * Status conditions from Crystal Server combat.
 *
 * Idle has no tiles, so a monster's earth/fire/energy/death *combat* hit
 * (not a melee swing) applies the matching condition. Damage and interval
 * follow the same shape as CONDITION_POISON / FIRE / ENERGY / CURSE / FREEZING:
 * a handful of ticks, each a fraction of the hit that applied it.
 *
 * No extra RNG draws — applying a condition must not reorder later combat
 * rolls, or replayed sessions would diverge.
 */

const FROM_DAMAGE: Partial<Record<CombatType, { id: ConditionId; intervalMs: number }>> = {
  COMBAT_EARTHDAMAGE: { id: 'poison', intervalMs: 4000 },
  COMBAT_FIREDAMAGE: { id: 'burning', intervalMs: 2000 },
  COMBAT_ENERGYDAMAGE: { id: 'electrified', intervalMs: 4000 },
  COMBAT_DEATHDAMAGE: { id: 'cursed', intervalMs: 4000 },
  COMBAT_ICEDAMAGE: { id: 'freezing', intervalMs: 4000 },
};

const TICKS = 8;

export function conditionFromDamage(damageType: CombatType): { id: ConditionId; intervalMs: number } | undefined {
  return FROM_DAMAGE[damageType];
}

export function applyCondition(session: HuntSession, damageType: CombatType, hit: number): ActiveCondition | null {
  const spec = FROM_DAMAGE[damageType];
  if (!spec || hit <= 0) return null;
  const intervalTicks = Math.max(1, Math.round(spec.intervalMs / TICK_MS));
  const damage = Math.max(1, Math.floor(hit * 0.08));
  session.conditions ??= [];
  const existing = session.conditions.find((entry) => entry.id === spec.id);
  if (existing) {
    existing.damage = Math.max(existing.damage, damage);
    existing.ticksLeft = TICKS;
    existing.intervalTicks = intervalTicks;
    existing.nextTick = intervalTicks;
    existing.damageType = damageType;
    return existing;
  }
  const applied: ActiveCondition = {
    id: spec.id,
    damageType,
    ticksLeft: TICKS,
    intervalTicks,
    nextTick: intervalTicks,
    damage,
  };
  session.conditions.push(applied);
  return applied;
}

export function tickConditions(
  session: HuntSession,
  emit: (event: SimEvent) => void,
): void {
  const character = session.character;
  const remaining: ActiveCondition[] = [];
  for (const condition of session.conditions ?? []) {
    condition.nextTick -= 1;
    if (condition.nextTick <= 0 && condition.ticksLeft > 0) {
      const amount = Math.min(condition.damage, Math.max(0, character.health));
      if (amount > 0) {
        character.health -= amount;
        session.totals.damageTaken += amount;
        emit({
          tick: session.tick,
          type: 'condition',
          amount,
          damageType: condition.damageType,
          skill: condition.id,
        });
      }
      condition.ticksLeft -= 1;
      condition.nextTick = condition.intervalTicks;
    }
    if (condition.ticksLeft > 0) remaining.push(condition);
  }
  session.conditions = remaining;
}

export function clearCondition(session: HuntSession, id: ConditionId): boolean {
  const before = (session.conditions ?? []).length;
  session.conditions = (session.conditions ?? []).filter((entry) => entry.id !== id);
  return session.conditions.length < before;
}
