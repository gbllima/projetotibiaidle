import { charms } from '@tibia-idle/data';
import type { Rng } from './rng.js';
import type { CharacterState, ConditionId } from './types.js';

/**
 * Bound-charm combat, using CipSoft's chance tables at rank 1 (the only rank
 * an idle character spends points on). Offensive charms deal a slice of the
 * creature's max HP once per proc; passives tweak loot / crit / leech.
 */

export interface CharmStrike {
  damage: number;
  critBonus: number;
  leech: number;
}

export function boundCharms(character: CharacterState, monsterId: string) {
  return (character.charmBinds ?? [])
    .filter((bind) => bind.monsterId === monsterId)
    .map((bind) => charms.find((entry) => entry.id === bind.charmId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

/** Rank-1 proc chance. Scavenge's 60+ values are percents of extra creature products, not a roll. */
function procChance(charm: { chance: readonly number[] }): number {
  const value = charm.chance[0] ?? 0;
  return value > 30 ? 0 : value;
}

export function charmPassive(character: CharacterState, monsterId: string): {
  loot: number;
  experience: number;
  damage: number;
  defense: number;
  critChance: number;
  dodge: number;
} {
  let loot = 1;
  let experience = 1;
  let damage = 1;
  let defense = 0;
  let critChance = 0;
  let dodge = 0;
  for (const charm of boundCharms(character, monsterId)) {
    switch (charm.name) {
      case 'Gut':
        loot *= 1.05;
        break;
      case 'Scavenge':
        loot *= 1 + (charm.chance[0] ?? 60) / 1000;
        break;
      case 'Bless':
        experience *= 1 + (charm.percent ?? 10) / 1000;
        break;
      case 'Low Blow':
        critChance += (charm.chance[0] ?? 4) * 100;
        break;
      case 'Savage Blow':
        damage *= 1.04;
        break;
      case 'Parry':
      case 'Dodge':
        dodge += (charm.chance[0] ?? 5) / 100;
        break;
      case 'Adrenaline Burst':
        damage *= 1.02;
        break;
      default:
        break;
    }
  }
  return { loot, experience, damage, defense, critChance, dodge };
}

/** Extra damage rolled on a hit against the bound species. */
export function charmStrike(
  character: CharacterState,
  monsterId: string,
  maxHealth: number,
  rng: Rng,
  maxMana = 0,
  playerMaxHealth = 0,
): CharmStrike {
  let damage = 0;
  let critBonus = 0;
  let leech = 0;
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.type === 'CHARM_OFFENSIVE') {
      const chance = procChance(charm);
      if (chance > 0 && rng.chance(chance)) {
        const percent = charm.percent ?? 5;
        if (charm.name === 'Overpower') {
          damage += Math.max(1, Math.floor(playerMaxHealth * (percent / 100)));
        } else if (charm.name === 'Overflux') {
          damage += Math.max(1, Math.floor(maxMana * (percent / 100)));
        } else {
          damage += Math.max(1, Math.floor(maxHealth * (percent / 100)));
        }
      }
      continue;
    }
    if (charm.name === 'Vampiric Embrace' && rng.chance(charm.chance[0] ?? 1.6)) {
      leech += 0.02;
    }
    if (charm.name === "Void's Call" && rng.chance(charm.chance[0] ?? 0.8)) {
      leech += 0.01;
    }
  }
  return { damage, critBonus, leech };
}

/** Dodge chance from charms, as a 0–100 percent matching forge Ruse. */
export function charmDodgePercent(character: CharacterState, monsterId: string): number {
  return charmPassive(character, monsterId).dodge * 100;
}

/** Parry reflects part of incoming damage back to the attacker. */
export function charmParryReflect(
  character: CharacterState,
  monsterId: string,
  incoming: number,
  rng: Rng,
): number {
  if (incoming <= 0) return 0;
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Parry') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) return Math.max(1, Math.floor(incoming));
  }
  return 0;
}

/** Cleanse one random active condition after a hit. */
export function charmCleanse(
  character: CharacterState,
  monsterId: string,
  conditions: ConditionId[],
  rng: Rng,
): ConditionId | null {
  if (conditions.length === 0) return null;
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Cleanse') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) {
      return conditions[rng.uniform(0, conditions.length - 1)] ?? null;
    }
  }
  return null;
}

/** Adrenaline Burst extends haste after taking a hit. */
export function charmAdrenalineBurst(character: CharacterState, monsterId: string, rng: Rng): boolean {
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Adrenaline Burst') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) return true;
  }
  return false;
}

/** Carnage splash when a bound species dies. */
export function charmCarnageDamage(
  character: CharacterState,
  killedMonsterId: string,
  victimMaxHealth: number,
  rng: Rng,
): number {
  for (const charm of boundCharms(character, killedMonsterId)) {
    if (charm.name !== 'Carnage') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) {
      const percent = charm.percent ?? 15;
      return Math.max(1, Math.floor(victimMaxHealth * (percent / 100)));
    }
  }
  return 0;
}

/** Fatal Hold: 30 seconds where the creature cannot flee from low HP. */
export const FATAL_HOLD_MS = 30_000;

export function charmFatalHold(
  character: CharacterState,
  monsterId: string,
  rng: Rng,
): boolean {
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Fatal Hold') continue;
    const chance = charm.chance[0] ?? 30;
    // Scavenge-style high percents are not roll chances; Fatal Hold is 30/45/60.
    if (chance > 0 && rng.chance(Math.min(100, chance))) return true;
  }
  return false;
}

/** Crystal Cripple / Numb: 10 seconds of paralysis on the bound species. */
export const CHARM_PARALYZE_MS = 10_000;

export function charmCrippleParalyze(
  character: CharacterState,
  monsterId: string,
  rng: Rng,
): boolean {
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Cripple') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) return true;
  }
  return false;
}

export function charmNumbParalyze(
  character: CharacterState,
  monsterId: string,
  rng: Rng,
): boolean {
  for (const charm of boundCharms(character, monsterId)) {
    if (charm.name !== 'Numb') continue;
    const chance = procChance(charm);
    if (chance > 0 && rng.chance(chance)) return true;
  }
  return false;
}
