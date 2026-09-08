import { itemsById, type Item } from '@tibia-idle/data';
import { isDistanceVocation, isMagicVocation } from './character.js';

/**
 * Keys match `/assets/attack/*-strip.webp` sprites.
 * Crystal maps CONST_ME_*_ATTACK (304-309) → client weapon mark 1-6.
 */
export type AttackEffectKey = 'sword' | 'axe' | 'club' | 'fist' | 'monk-staff' | 'monk-daggers';

const MELEE_ATTACK_MAP: Record<string, AttackEffectKey> = {
  sword: 'sword',
  swordattack: 'sword',
  club: 'club',
  clubattack: 'club',
  axe: 'axe',
  axeattack: 'axe',
  fist: 'fist',
  fistattack: 'fist',
  monkstaff: 'monk-staff',
  monkstaffattack: 'monk-staff',
  monkdaggers: 'monk-daggers',
  monkdaggersattack: 'monk-daggers',
};

function normalizeMeleeTag(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

/** Mirror Crystal Weapon::getWeaponAttackEffect — basic auto-attack swing only. */
export function attackEffectFromWeapon(weapon: Item | null): AttackEffectKey | undefined {
  if (!weapon) return 'fist';

  const tagged = weapon.meleeAttackEffect
    ? MELEE_ATTACK_MAP[normalizeMeleeTag(weapon.meleeAttackEffect)]
    : undefined;
  if (tagged) return tagged;

  switch (weapon.weaponType) {
    case 'sword':
      return 'sword';
    case 'club':
      return 'club';
    case 'axe':
      return 'axe';
    case 'fist':
      return 'fist';
    default:
      return undefined;
  }
}

/** Tibia 15.30-style melee swing FX for knight / monk auto-attacks. */
export function attackEffectFor(
  vocationId: number,
  weaponItemId: number | undefined,
): AttackEffectKey | undefined {
  if (isMagicVocation(vocationId) || isDistanceVocation(vocationId)) return undefined;
  const weapon = weaponItemId ? itemsById.get(weaponItemId) ?? null : null;
  return attackEffectFromWeapon(weapon);
}
