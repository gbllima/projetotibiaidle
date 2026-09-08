import type { CombatType } from '@tibia-idle/data';
import type { CharacterState, HuntSession, HuntSummon, SimEvent } from './types.js';
import { TICK_MS } from './types.js';

/**
 * Vocation familiars — Crystal `familiars.xml` + `spells/familiar/*.lua`.
 *
 * Duration is half of FAMILIAR_TIME (default 30 min → 15 min active).
 * Recast cooldown matches Crystal: duration × 2 (30 min).
 * Damage is an idle-averaged slice of the familiar monster scripts.
 */

export const FAMILIAR_LEVEL = 200;
export const FAMILIAR_DURATION_MS = 15 * 60_000;
export const FAMILIAR_COOLDOWN_MS = 30 * 60_000;

export interface FamiliarSpec {
  /** Base + promoted vocation ids. */
  vocations: number[];
  name: string;
  words: string;
  mana: number;
  lookType: number;
  minDamage: number;
  maxDamage: number;
  damageType: CombatType;
}

export const FAMILIARS: readonly FamiliarSpec[] = [
  {
    vocations: [1, 5],
    name: 'Thundergiant',
    words: 'utevo gran res ven',
    mana: 3000,
    lookType: 994,
    minDamage: 120,
    maxDamage: 220,
    damageType: 'COMBAT_ENERGYDAMAGE',
  },
  {
    vocations: [2, 6],
    name: 'Grovebeast',
    words: 'utevo gran res dru',
    mana: 3000,
    lookType: 993,
    minDamage: 120,
    maxDamage: 240,
    damageType: 'COMBAT_EARTHDAMAGE',
  },
  {
    vocations: [3, 7],
    name: 'Emberwing',
    words: 'utevo gran res sac',
    mana: 2000,
    lookType: 992,
    minDamage: 110,
    maxDamage: 210,
    damageType: 'COMBAT_FIREDAMAGE',
  },
  {
    vocations: [4, 8],
    name: 'Skullfrost',
    words: 'utevo gran res eq',
    mana: 1000,
    lookType: 991,
    minDamage: 100,
    maxDamage: 200,
    damageType: 'COMBAT_ICEDAMAGE',
  },
  {
    vocations: [9, 10],
    name: 'Omniphant',
    words: 'utevo gran res tio',
    mana: 1500,
    lookType: 1818,
    minDamage: 100,
    maxDamage: 200,
    damageType: 'COMBAT_ENERGYDAMAGE',
  },
];

export function familiarFor(vocationId: number): FamiliarSpec | null {
  return FAMILIARS.find((entry) => entry.vocations.includes(vocationId)) ?? null;
}

export function hasActiveFamiliar(session: HuntSession, name: string): boolean {
  return (session.summons ?? []).some((entry) => entry.name === name || entry.familiar);
}

export function trySummonFamiliar(
  session: HuntSession,
  emit: (event: SimEvent) => void,
  policyFamiliar: boolean,
): boolean {
  if (policyFamiliar === false) return false;
  const character = session.character;
  const spec = familiarFor(character.vocationId);
  if (!spec) return false;
  if (character.level < FAMILIAR_LEVEL) return false;
  if ((session.familiarCooldown ?? 0) > 0) return false;
  if (character.mana < spec.mana) return false;
  if ((session.summons?.length ?? 0) >= 2) return false;
  if (hasActiveFamiliar(session, spec.name)) return false;

  character.mana -= spec.mana;
  session.summons ??= [];
  const ticks = Math.max(1, Math.round(FAMILIAR_DURATION_MS / TICK_MS));
  const summon: HuntSummon = {
    uid: session.nextUid++,
    name: spec.name,
    minDamage: spec.minDamage,
    maxDamage: spec.maxDamage,
    damageType: spec.damageType,
    lookType: spec.lookType,
    familiar: true,
    ticksLeft: ticks,
    attackCooldown: 0,
  };
  session.summons.push(summon);
  session.familiarCooldown = Math.max(1, Math.round(FAMILIAR_COOLDOWN_MS / TICK_MS));
  emit({ tick: session.tick, type: 'buff', words: spec.words, amount: spec.lookType });
  return true;
}

/** Display helper for UI. */
export function familiarLabel(character: CharacterState): string | null {
  const spec = familiarFor(character.vocationId);
  if (!spec) return null;
  return `${spec.name} · ${spec.words}`;
}
