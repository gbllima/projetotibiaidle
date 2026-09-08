import { itemsById } from '@tibia-idle/data';
import type { AmmoProfile } from './ammo.js';
import type { CharacterState, DerivedStats } from './types.js';
import { isDistanceVocation } from './character.js';
import { ammoProfile } from './ammo.js';
import { ammoToConsume } from './supplies.js';

/** Idle hunts assume adjacent range (monster box around the player). */
export const IDLE_HUNT_DISTANCE = 1;

function equippedBowHitChance(character: CharacterState): number {
  for (const slot of ['left', 'right'] as const) {
    const id = character.equipment[slot];
    if (!id) continue;
    const item = itemsById.get(id);
    if (!item) continue;
    if (item.weaponType === 'distance' || /\b(bow|crossbow)\b/i.test(item.name)) {
      return Math.max(0, item.hitChance ?? 0);
    }
  }
  return 0;
}

/**
 * Crystal `WeaponDistance::getHitChance` (weapons.cpp) — distance skill, range,
 * maxHitChance tier, bow bonus, low-level helper.
 */
export function distanceHitChance(
  character: CharacterState,
  stats: DerivedStats,
  profile: AmmoProfile,
  distance = IDLE_HUNT_DISTANCE,
): number {
  const skill = stats.attackSkill;
  let chance: number;

  if (profile.hitChance === 0) {
    const maxHitChance = profile.maxHitChance ?? 90;
    if (maxHitChance === 75) {
      switch (distance) {
        case 1:
        case 5:
          chance = Math.min(skill, 74) + 1;
          break;
        case 2:
          chance = Math.floor(Math.min(skill, 28) * 2.4) + 8;
          break;
        case 3:
          chance = Math.floor(Math.min(skill, 45) * 1.55) + 6;
          break;
        case 4:
          chance = Math.floor(Math.min(skill, 58) * 1.25) + 3;
          break;
        case 6:
          chance = Math.floor(Math.min(skill, 90) * 0.8) + 3;
          break;
        case 7:
          chance = Math.floor(Math.min(skill, 104) * 0.7) + 2;
          break;
        default:
          chance = profile.hitChance;
      }
    } else if (maxHitChance === 90) {
      switch (distance) {
        case 1:
        case 5:
          chance = Math.floor(Math.min(skill, 74) * 1.2) + 1;
          break;
        case 2:
          chance = Math.floor(Math.min(skill, 28) * 3.2);
          break;
        case 3:
          chance = Math.min(skill, 45) * 2;
          break;
        case 4:
          chance = Math.floor(Math.min(skill, 58) * 1.55);
          break;
        case 6:
        case 7:
          chance = Math.min(skill, 90);
          break;
        default:
          chance = profile.hitChance;
      }
    } else if (maxHitChance === 100) {
      switch (distance) {
        case 1:
        case 5:
          chance = Math.floor(Math.min(skill, 73) * 1.35) + 1;
          break;
        case 2:
          chance = Math.floor(Math.min(skill, 30) * 3.2) + 4;
          break;
        case 3:
          chance = Math.floor(Math.min(skill, 48) * 2.05) + 2;
          break;
        case 4:
          chance = Math.floor(Math.min(skill, 65) * 1.5) + 2;
          break;
        case 6:
          chance = Math.floor(Math.min(skill, 87) * 1.2) - 4;
          break;
        case 7:
          chance = Math.floor(Math.min(skill, 90) * 1.1) + 1;
          break;
        default:
          chance = profile.hitChance;
      }
    } else {
      chance = maxHitChance;
    }
  } else {
    chance = profile.hitChance;
  }

  chance += equippedBowHitChance(character);
  if (character.level < 20) chance += 50;
  return Math.min(100, Math.max(0, chance));
}

/** Ammo id used for hit-chance display (quiver slot, else next stack to spend). */
function displayAmmoId(character: CharacterState): number | null {
  if (character.equipment.ammo) return character.equipment.ammo;
  return ammoToConsume(character);
}

/** Display hit chance for Build / API (distance vocations with ammo only). */
export function combatHitChance(
  character: CharacterState,
  stats: DerivedStats,
): number | null {
  if (!isDistanceVocation(character.vocationId)) return null;
  const ammoId = displayAmmoId(character);
  if (!ammoId) return null;
  const profile = ammoProfile(ammoId);
  if (!profile) return null;
  return distanceHitChance(character, stats, profile);
}
