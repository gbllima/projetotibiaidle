import { itemsById } from '@tibia-idle/data';
import { deriveStats, isMagicVocation } from './character.js';
import { clearCondition } from './conditions.js';
import { jewelryKite } from './jewelry.js';
import { clampHarmony, HARMONY_MAX } from './harmony.js';
import { imbueSpeedBonus } from './imbuements.js';
import { trySummonFamiliar } from './familiars.js';
import { isSpellGroupReady } from './spells.js';
import { TICK_MS, type CharacterState, type ConditionId, type HuntPolicy, type HuntSession, type SimEvent } from './types.js';

const MS_PER_TICK = TICK_MS;

function msToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / MS_PER_TICK));
}

/** Outgoing damage multiplier from Helper attack stances. */
export function helperOutgoingDamageMult(
  session: HuntSession,
  policy: HuntPolicy,
  physical: boolean,
  distance: boolean,
): number {
  let mult = 1;
  if (session.bloodRageActive && policy.bloodRage && physical) mult *= 1.3;
  if (session.protectorActive && policy.protector && physical) mult *= 0.85;
  if (session.sharpshooterActive && policy.sharpshooter && distance) mult *= 1.4;
  return mult;
}

/** Incoming damage multiplier from Helper stances. */
export function helperIncomingDamageMult(session: HuntSession, policy: HuntPolicy): number {
  let mult = 1;
  if (session.bloodRageActive && policy.bloodRage) mult *= 1.15;
  if (session.protectorActive && policy.protector) mult *= 0.85;
  return mult;
}

function setSupportCooldown(session: HuntSession, ms: number): void {
  session.spellCooldowns ??= {};
  session.spellCooldowns.support = msToTicks(ms);
}

function isKnight(vocationId: number): boolean {
  return vocationId === 4 || vocationId === 8;
}

function isPaladin(vocationId: number): boolean {
  return vocationId === 3 || vocationId === 7;
}

/** utito tempo / utamo tempo / utori con — Crystal support group, 2s cooldown. */
function applyAttackStances(
  session: HuntSession,
  emit: (event: SimEvent) => void,
  policy: HuntPolicy,
): void {
  const character = session.character;
  if (!isSpellGroupReady(session.spellCooldowns ?? {}, 'support')) return;

  if (!policy.bloodRage) session.bloodRageActive = false;
  if (!policy.protector) session.protectorActive = false;
  if (!policy.sharpshooter) session.sharpshooterActive = false;

  if (policy.bloodRage && isKnight(character.vocationId) && character.level >= 60
    && character.mana >= 290 && !session.bloodRageActive) {
    character.mana -= 290;
    session.bloodRageActive = true;
    session.protectorActive = false;
    setSupportCooldown(session, 2000);
    emit({ tick: session.tick, type: 'buff', words: 'utito tempo', amount: 0 });
    return;
  }
  if (policy.protector && isKnight(character.vocationId) && character.level >= 55
    && character.mana >= 200 && !session.protectorActive) {
    character.mana -= 200;
    session.protectorActive = true;
    session.bloodRageActive = false;
    setSupportCooldown(session, 2000);
    emit({ tick: session.tick, type: 'buff', words: 'utamo tempo', amount: 0 });
    return;
  }
  if (policy.sharpshooter && isPaladin(character.vocationId) && character.level >= 60
    && character.mana >= 450 && !session.sharpshooterActive) {
    character.mana -= 450;
    session.sharpshooterActive = true;
    setSupportCooldown(session, 2000);
    emit({ tick: session.tick, type: 'buff', words: 'utori con', amount: 0 });
  }
}
/**
 * Support spells and food.
 *
 * Haste is movement in Tibia. Idle has no map, so the authentic mapping is
 * kiting: a hasted ranged/caster takes fewer melee hits. Knights still recast
 * it (mana + words) because that is what they do in the real client.
 *
 * Food fills a duration bar. While fed, regeneration is 20% higher — the idle
 * equivalent of hunting well-fed rather than gating regen behind hunger.
 */

export interface HasteSpell {
  words: string;
  mana: number;
  durationMs: number;
  /** Multiplier on rangedExposure. 1.3 speed → ~0.77 incoming melee. */
  kite: number;
}

export const FOOD_ITEMS = [
  { itemId: 3725, name: 'brown mushroom', durationMs: 264_000 },
  { itemId: 3582, name: 'ham', durationMs: 360_000 },
  { itemId: 3723, name: 'white mushroom', durationMs: 216_000 },
  { itemId: 3583, name: 'dragon ham', durationMs: 720_000 },
] as const;

const FOOD_IDS: ReadonlySet<number> = new Set(FOOD_ITEMS.map((entry) => entry.itemId));

export function hasteSpellFor(character: CharacterState): HasteSpell | null {
  if (character.level < 14) return null;
  const strong = (isMagicVocation(character.vocationId) || character.vocationId === 9 || character.vocationId === 10)
    && character.level >= 20;
  if (strong) {
    return { words: 'utani gran hur', mana: 100, durationMs: 22_000, kite: 1 / 1.7 };
  }
  return { words: 'utani hur', mana: 60, durationMs: 30_000, kite: 1 / 1.3 };
}

export function hasteKite(session: HuntSession, isMelee: boolean): number {
  let kite = jewelryKite(session.character);
  if (!isMelee && (session.hasteTicks ?? 0) > 0) {
    kite *= hasteSpellFor(session.character)?.kite ?? 1;
  }
  // Crystal base speed ~220; Swiftness +10/+15/+30 reduces how often melee packs land.
  const now = (session.startedAt ?? 0) + session.tick * TICK_MS;
  const speed = imbueSpeedBonus(session.character, now);
  if (speed > 0) kite *= 220 / (220 + speed);
  return kite;
}

export function foodDurationMs(itemId: number): number {
  return FOOD_ITEMS.find((entry) => entry.itemId === itemId)?.durationMs ?? 264_000;
}

export function isFoodItem(itemId: number): boolean {
  return FOOD_IDS.has(itemId) || (itemsById.get(itemId)?.name ?? '').toLowerCase().includes('mushroom');
}

export function pickFood(character: CharacterState): number | null {
  for (const food of FOOD_ITEMS) {
    if (character.supplies.some((stack) => stack.itemId === food.itemId && stack.count > 0)) return food.itemId;
  }
  return null;
}

export function tickBuffs(session: HuntSession): void {
  session.hasteTicks = Math.max(0, (session.hasteTicks ?? 0) - 1);
  session.foodTicks = Math.max(0, (session.foodTicks ?? 0) - 1);
  session.magicShieldTicks = Math.max(0, (session.magicShieldTicks ?? 0) - 1);
  session.focusHarmonyCooldown = Math.max(0, (session.focusHarmonyCooldown ?? 0) - 1);
  session.familiarCooldown = Math.max(0, (session.familiarCooldown ?? 0) - 1);
}

export interface MagicShieldSpell {
  words: string;
  mana: number;
  durationMs: number;
  level: number;
}

/** Crystal utamo vita: sorcerer/druid, 50 mana, 200 seconds. */
export function magicShieldSpellFor(character: CharacterState): MagicShieldSpell | null {
  if (!isMagicVocation(character.vocationId) || character.level < 14) return null;
  return { words: 'utamo vita', mana: 50, durationMs: 200_000, level: 14 };
}

export const CURE_SPELLS: Array<{ id: ConditionId; words: string; mana: number; level: number }> = [
  { id: 'poison', words: 'exana pox', mana: 30, level: 10 },
  { id: 'burning', words: 'exana flam', mana: 30, level: 10 },
  { id: 'electrified', words: 'exana vis', mana: 30, level: 10 },
  { id: 'cursed', words: 'exana mort', mana: 40, level: 14 },
  { id: 'freezing', words: 'exana frigo', mana: 30, level: 10 },
];

export function applySupport(
  session: HuntSession,
  emit: (event: SimEvent) => void,
  consume: (itemId: number) => boolean,
  policy = session.character.policy,
): void {
  const character = session.character;
  if (policy.haste !== false) {
    const haste = hasteSpellFor(character);
    if (haste && (session.hasteTicks ?? 0) <= 0 && character.mana >= haste.mana) {
      character.mana -= haste.mana;
      session.hasteTicks = Math.max(1, Math.round(haste.durationMs / TICK_MS));
      emit({ tick: session.tick, type: 'buff', words: haste.words, amount: 0 });
    }
  }
  if (policy.magicShield) {
    const shield = magicShieldSpellFor(character);
    const hpRatio = character.health / Math.max(1, deriveStats(character).maxHealth);
    if (
      shield
      && (session.magicShieldTicks ?? 0) <= 0
      && character.mana >= shield.mana
      && hpRatio < (policy.magicShieldAt ?? 0.4)
    ) {
      character.mana -= shield.mana;
      session.magicShieldTicks = Math.max(1, Math.round(shield.durationMs / TICK_MS));
      emit({ tick: session.tick, type: 'buff', words: shield.words, amount: 0 });
    }
  }  if (policy.cure !== false) {
    for (const cure of CURE_SPELLS) {
      if (character.level < cure.level || character.mana < cure.mana) continue;
      if (!(session.conditions ?? []).some((entry) => entry.id === cure.id)) continue;
      character.mana -= cure.mana;
      clearCondition(session, cure.id);
      emit({ tick: session.tick, type: 'buff', words: cure.words, skill: cure.id });
      break;
    }
  }
  if (policy.food !== false && (session.foodTicks ?? 0) <= 0) {
    const itemId = pickFood(character);
    if (itemId && consume(itemId)) {
      session.foodTicks = Math.max(1, Math.round(foodDurationMs(itemId) / TICK_MS));
      emit({ tick: session.tick, type: 'buff', itemId, amount: 0 });
    }
  }

  applyMonkSupport(session, emit, policy);
  applyAttackStances(session, emit, policy);
  trySummonFamiliar(session, emit, policy.familiar !== false);
}

function isMonk(vocationId: number): boolean {
  return vocationId === 9 || vocationId === 10;
}

function applyMonkSupport(
  session: HuntSession,
  emit: (event: SimEvent) => void,
  policy = session.character.policy,
): void {
  const character = session.character;
  if (!isMonk(character.vocationId)) return;

  if (policy.virtueHarmony !== false && !character.virtueHarmony && character.level >= 20 && character.mana >= 210) {
    character.mana -= 210;
    character.virtueHarmony = true;
    character.harmony = clampHarmony(Math.max(1, character.harmony ?? 0), true);
    emit({ tick: session.tick, type: 'buff', words: 'utori virtu', amount: character.harmony });
  }

  if (
    policy.focusHarmony !== false
    && character.level >= 275
    && (session.focusHarmonyCooldown ?? 0) <= 0
    && (character.harmony ?? 0) < HARMONY_MAX
    && character.mana >= 500
  ) {
    character.mana -= 500;
    character.harmony = HARMONY_MAX;
    session.focusHarmonyCooldown = Math.max(1, Math.round(120_000 / TICK_MS));
    emit({ tick: session.tick, type: 'buff', words: 'utevo nia', amount: HARMONY_MAX });
  }
}

export function foodRegenBonus(session: HuntSession): number {
  return (session.foodTicks ?? 0) > 0 ? 1.2 : 1;
}
