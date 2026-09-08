import type { SkillName } from '@tibia-idle/data';
import type { CharacterState } from './types.js';

/**
 * Exercise weapons from Crystal's exercise_training_weapons.lua.
 *
 * Each charge grants 7 skill tries (or 600 mana spent for magic) at a dummy.
 * Offline training uses the same 8 s cadence as the free dummy, but burns charges.
 */

export type ExerciseSkill = SkillName | 'magic';

export interface ExerciseWeapon {
  itemId: number;
  skill: ExerciseSkill;
}

export const EXERCISE_WEAPONS: ExerciseWeapon[] = [
  { itemId: 28552, skill: 'sword' },
  { itemId: 35279, skill: 'sword' },
  { itemId: 35285, skill: 'sword' },
  { itemId: 28553, skill: 'axe' },
  { itemId: 35280, skill: 'axe' },
  { itemId: 35286, skill: 'axe' },
  { itemId: 28554, skill: 'club' },
  { itemId: 35281, skill: 'club' },
  { itemId: 35287, skill: 'club' },
  { itemId: 28555, skill: 'distance' },
  { itemId: 35282, skill: 'distance' },
  { itemId: 35288, skill: 'distance' },
  { itemId: 28556, skill: 'magic' },
  { itemId: 35283, skill: 'magic' },
  { itemId: 35289, skill: 'magic' },
  { itemId: 28557, skill: 'magic' },
  { itemId: 35284, skill: 'magic' },
  { itemId: 35290, skill: 'magic' },
  { itemId: 44065, skill: 'shield' },
  { itemId: 44066, skill: 'shield' },
  { itemId: 44067, skill: 'shield' },
  { itemId: 50292, skill: 'fist' },
  { itemId: 50293, skill: 'fist' },
  { itemId: 50294, skill: 'fist' },
  { itemId: 50295, skill: 'fist' },
];

const BY_ITEM = new Map(EXERCISE_WEAPONS.map((entry) => [entry.itemId, entry]));

export function exerciseWeaponFor(itemId: number): ExerciseWeapon | undefined {
  return BY_ITEM.get(itemId);
}

export function exerciseItemIdsFor(skill: ExerciseSkill): number[] {
  return EXERCISE_WEAPONS.filter((entry) => entry.skill === skill).map((entry) => entry.itemId);
}

function takeCharge(character: CharacterState, itemId: number): boolean {
  const supply = character.supplies.find((stack) => stack.itemId === itemId && stack.count > 0);
  if (supply) {
    supply.count -= 1;
    return true;
  }
  const stored = character.warehouse.find((stack) => stack.itemId === itemId && stack.count > 0);
  if (stored) {
    stored.count -= 1;
    return true;
  }
  return false;
}

/** How many exercise charges can be spent for this skill. */
export function availableExerciseHits(character: CharacterState, skill: ExerciseSkill): number {
  let total = 0;
  for (const itemId of exerciseItemIdsFor(skill)) {
    total += character.supplies.find((stack) => stack.itemId === itemId)?.count ?? 0;
    total += character.warehouse.find((stack) => stack.itemId === itemId)?.count ?? 0;
  }
  return total;
}

/** Burns up to `hits` charges for `skill`. Returns charges actually used. */
export function consumeExerciseHits(character: CharacterState, skill: ExerciseSkill, hits: number): number {
  if (hits <= 0) return 0;
  let used = 0;
  for (const itemId of exerciseItemIdsFor(skill)) {
    while (used < hits && takeCharge(character, itemId)) used += 1;
    if (used >= hits) break;
  }
  return used;
}

/** Tries per charge: 7 for weapons, 600 mana spent for rods/wands. */
export function triesPerExerciseCharge(skill: ExerciseSkill): number {
  return skill === 'magic' ? 600 : 7;
}

const ROD_ITEMS = new Set([28556, 35283, 35289]);
const WAND_ITEMS = new Set([28557, 35284, 35290]);

/** CONST_ANI_* missile for a specific exercise item (Crystal training weapons). */
export function exerciseShootForItem(itemId: number): string | null {
  if (ROD_ITEMS.has(itemId)) return 'CONST_ANI_SMALLICE';
  if (WAND_ITEMS.has(itemId)) return 'CONST_ANI_FIRE';
  const weapon = exerciseWeaponFor(itemId);
  if (!weapon) return null;
  return exerciseShootEffect(weapon.skill);
}

/** Default exercise dummy missile per trained skill (Tibia Global whirlwind / arrow / rod / wand). */
export function exerciseShootEffect(skill: ExerciseSkill): string | null {
  switch (skill) {
    case 'sword': return 'CONST_ANI_WHIRLWINDSWORD';
    case 'axe': return 'CONST_ANI_WHIRLWINDAXE';
    case 'club': return 'CONST_ANI_WHIRLWINDCLUB';
    case 'distance': return 'CONST_ANI_ARROW';
    case 'magic': return 'CONST_ANI_ENERGY';
    case 'fist': return 'CONST_ANI_WHIRLWINDCLUB';
    case 'shield': return null;
    default: return 'CONST_ANI_ENERGY';
  }
}

/** Pick missile from supplies (exercise item) or fall back to skill default. */
export function exerciseShootForTraining(
  skill: ExerciseSkill,
  supplies: Array<{ itemId: number; count: number }>,
): string | null {
  for (const itemId of exerciseItemIdsFor(skill)) {
    const count = supplies.find((stack) => stack.itemId === itemId)?.count ?? 0;
    if (count > 0) return exerciseShootForItem(itemId);
  }
  return exerciseShootEffect(skill);
}
