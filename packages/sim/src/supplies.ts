import { itemsById, itemsByName } from '@tibia-idle/data';
import { ammoProfile, isAmmoItem } from './ammo.js';
import { isDistanceVocation, isMagicVocation } from './character.js';
import { takeItemStack } from './loot.js';
import { bestRune, runeById, runeUseCost } from './runes.js';
import type { CharacterState, SupplyStack } from './types.js';

const FALLBACK_AMMO_NAMES = ['arrow', 'bolt', 'spear'] as const;

export function ammoItemIds(): number[] {
  return FALLBACK_AMMO_NAMES
    .map((name) => itemsByName.get(name)?.id)
    .filter((id): id is number => typeof id === 'number');
}

/** Ammo stacks currently in the bag (any arrow/bolt/special ammo). */
function ammoInBag(character: CharacterState): number[] {
  const ids: number[] = [];
  for (const stack of character.supplies) {
    if (stack.count <= 0) continue;
    const item = itemsById.get(stack.itemId);
    if (item && isAmmoItem(item)) ids.push(stack.itemId);
  }
  return ids;
}

/**
 * Ammo the paladin spends on each swing: the quiver slot if that stack is in
 * the bag (Crystal: what is loaded). Never auto-swap to a higher-attack AoE
 * arrow from the backpack — that made basic shots look like multi-target.
 */
export function ammoToConsume(character: CharacterState): number | null {
  const equipped = character.equipment.ammo;
  if (equipped && character.supplies.some((stack) => stack.itemId === equipped && stack.count > 0)) {
    return equipped;
  }
  const bag = ammoInBag(character);
  if (bag.length) {
    // Prefer a non-area stack when the quiver is empty so we don't silently fire burst/diamond.
    for (const itemId of bag) {
      const profile = ammoProfile(itemId);
      if (profile && !profile.area && profile.level <= character.level) return itemId;
    }
    for (const itemId of bag) {
      const profile = ammoProfile(itemId);
      if (profile && profile.level <= character.level) return itemId;
    }
    return bag[0] ?? null;
  }
  for (const itemId of ammoItemIds()) {
    if (character.supplies.some((stack) => stack.itemId === itemId && stack.count > 0)) return itemId;
  }
  return null;
}

/** Crystal CONST_ANI_* for the ammo the paladin just spent. */
export function ammoShoot(itemId: number): string {
  return ammoProfile(itemId)?.shoot ?? 'CONST_ANI_ARROW';
}

/**
 * Supply loadouts.
 *
 * Potions are the main gold sink in a hunt, so what a character carries decides
 * whether a zone is profitable. The tiers here mirror
 * data/scripts/actions/items/potions.lua, including the level requirements
 * that make a low level character unable to drink the strong ones.
 */

export interface PotionTier {
  itemId: number;
  name: string;
  /** Minimum character level required to drink it. */
  level: number;
  min: number;
  max: number;
}

/** Spirit potions restore both HP and MP (Crystal great/ultimate spirit). */
export interface SpiritPotionTier extends PotionTier {
  manaMin: number;
  manaMax: number;
}

/** Ranges from servidor/data/scripts/actions/items/potions.lua (15.25). */
export const HEALTH_POTION_TIERS: PotionTier[] = [
  { itemId: 266, name: 'health potion', level: 0, min: 125, max: 175 },
  { itemId: 236, name: 'strong health potion', level: 50, min: 250, max: 350 },
  { itemId: 239, name: 'great health potion', level: 80, min: 425, max: 575 },
  { itemId: 7643, name: 'ultimate health potion', level: 130, min: 650, max: 850 },
  { itemId: 23375, name: 'supreme health potion', level: 200, min: 875, max: 1125 },
];

export const MANA_POTION_TIERS: PotionTier[] = [
  { itemId: 268, name: 'mana potion', level: 0, min: 75, max: 125 },
  { itemId: 237, name: 'strong mana potion', level: 50, min: 115, max: 185 },
  { itemId: 238, name: 'great mana potion', level: 80, min: 150, max: 250 },
  { itemId: 23373, name: 'ultimate mana potion', level: 130, min: 425, max: 575 },
];

export const SPIRIT_POTION_TIERS: SpiritPotionTier[] = [
  { itemId: 7642, name: 'great spirit potion', level: 80, min: 250, max: 350, manaMin: 100, manaMax: 200 },
  { itemId: 23374, name: 'ultimate spirit potion', level: 130, min: 420, max: 580, manaMin: 250, manaMax: 350 },
];

export function potionById(itemId: number): PotionTier | SpiritPotionTier | undefined {
  return (
    HEALTH_POTION_TIERS.find((tier) => tier.itemId === itemId)
    ?? MANA_POTION_TIERS.find((tier) => tier.itemId === itemId)
    ?? SPIRIT_POTION_TIERS.find((tier) => tier.itemId === itemId)
  );
}

export function isSpiritVocation(vocationId: number): boolean {
  return vocationId === 3 || vocationId === 7 || vocationId === 9 || vocationId === 10;
}

/** Strongest spirit potion the character may drink and has in supplies. */
export function bestSpiritPotion(character: CharacterState, preferredId: number): SpiritPotionTier | null {
  if (preferredId > 0) {
    const chosen = SPIRIT_POTION_TIERS.find((tier) => tier.itemId === preferredId);
    if (chosen && character.level >= chosen.level
      && character.supplies.some((stack) => stack.itemId === chosen.itemId && stack.count > 0)) {
      return chosen;
    }
  }
  for (let i = SPIRIT_POTION_TIERS.length - 1; i >= 0; i -= 1) {
    const tier = SPIRIT_POTION_TIERS[i]!;
    if (character.level < tier.level) continue;
    if (character.supplies.some((stack) => stack.itemId === tier.itemId && stack.count > 0)) return tier;
  }
  return null;
}
/** Strongest tier the character is allowed to drink. */
export function bestTier(tiers: readonly PotionTier[], level: number): PotionTier {
  let best = tiers[0]!;
  for (const tier of tiers) {
    if (level >= tier.level && tier.level >= best.level) best = tier;
  }
  return best;
}

/**
 * A sensible supply pack for one hunting trip.
 *
 * The rates come from measuring real sessions with scripts/supply-usage.ts:
 * across every vocation hunting the hardest zone open to it, burn ranges from
 * a handful of potions an hour at low level to roughly 800 at level 700, and
 * casters spend on mana where melee spends on health.
 *
 * The counts sit above the measured peak on purpose. Unused potions are
 * refunded when the hunt ends, so overpacking only ties up gold for the
 * duration, while underpacking cuts the run short.
 */
function preferredTier(tiers: readonly PotionTier[], level: number, itemId: number): PotionTier {
  const chosen = itemId ? tiers.find((tier) => tier.itemId === itemId) : undefined;
  if (chosen && level >= chosen.level) return chosen;
  return bestTier(tiers, level);
}

export function defaultSupplies(character: CharacterState, hours = 1): SupplyStack[] {
  const caster = isMagicVocation(character.vocationId);
  const healthPerHour = 120 + character.level * 0.9;
  const manaPerHour = caster ? 300 + character.level * 0.6 : healthPerHour * 0.25;
  const packs: SupplyStack[] = [];
  if ((character.policy.healthPotionId ?? 0) >= 0) {
    const health = preferredTier(HEALTH_POTION_TIERS, character.level, character.policy.healthPotionId ?? 0);
    packs.push({ itemId: health.itemId, count: Math.round(healthPerHour * hours) });
  }
  if ((character.policy.manaPotionId ?? 0) >= 0) {
    const mana = preferredTier(MANA_POTION_TIERS, character.level, character.policy.manaPotionId ?? 0);
    packs.push({ itemId: mana.itemId, count: Math.round(manaPerHour * hours) });
  }
  if (isDistanceVocation(character.vocationId)) {
    const ammoId = character.equipment.ammo ?? itemsByName.get('arrow')?.id ?? itemsByName.get('spear')?.id;
    if (ammoId) {
      const ammoPerHour = 400 + character.level * 2;
      packs.push({ itemId: ammoId, count: Math.round(ammoPerHour * hours) });
    }
  }
  if (character.policy.food !== false) {
    packs.push({ itemId: 3725, count: Math.max(1, Math.round(14 * hours)) });
  }
  if ((character.policy.runeId ?? -1) >= 0) {
    const specified = character.policy.runeId > 0 ? runeById(character.policy.runeId) : undefined;
    const rune = specified ?? bestRune(character.vocationId, character.level, character.magicLevel, 4);
    if (rune) {
      // Attack-group shared with spells, so they are not thrown every 2 s.
      const usesPerHour = 800 + character.level;
      packs.push({ itemId: rune.itemId, count: Math.round(usesPerHour * hours) });
    }
  }
  if ((character.policy.soulRuneId ?? -1) >= 0 && character.level >= 27) {
    const soulId = character.policy.soulRuneId > 0 ? character.policy.soulRuneId : 3195;
    packs.push({ itemId: soulId, count: Math.max(1, Math.round(120 * hours)) });
  }
  if ((character.policy.supportRuneId ?? -1) >= 0 && character.level >= 27) {
    const supportId = character.policy.supportRuneId > 0 ? character.policy.supportRuneId : 3203;
    packs.push({ itemId: supportId, count: Math.max(1, Math.round(20 * hours)) });
  }
  return packs.filter((stack) => stack.count > 0);
}

export function supplyUnitCost(itemId: number): number {
  if (runeById(itemId)) return runeUseCost(itemId);
  return itemsById.get(itemId)?.buyPrice ?? 0;
}

/** Gold cost of a supply pack, at NPC buy prices. */
export function suppliesCost(supplies: readonly SupplyStack[]): number {
  let total = 0;
  for (const stack of supplies) {
    total += supplyUnitCost(stack.itemId) * stack.count;
  }
  return total;
}

/**
 * The largest pack the character can pay for, up to `maxHours`.
 *
 * A fresh character cannot afford a full day of potions, and refusing the hunt
 * over it would leave them with nothing to do. Instead they buy what they can
 * and the run ends when the bag is empty, which is the loop that makes each
 * trip fund a longer one.
 */
export function affordableSupplies(
  character: CharacterState,
  maxHours: number,
): { supplies: SupplyStack[]; cost: number; hours: number } {
  const perHour = suppliesCost(defaultSupplies(character, 1));
  if (perHour <= 0) {
    const supplies = defaultSupplies(character, maxHours);
    return { supplies, cost: 0, hours: maxHours };
  }

  let hours = Math.min(maxHours, character.gold / perHour);
  // Counts are rounded, so the priced pack can land slightly above the
  // estimate. Shrink until it fits rather than overdrawing the purse.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const supplies = defaultSupplies(character, hours);
    const cost = suppliesCost(supplies);
    if (cost <= character.gold) return { supplies, cost, hours };
    hours *= 0.9;
  }
  return { supplies: [], cost: 0, hours: 0 };
}

export function mergeSupplyStacks(stacks: readonly SupplyStack[]): SupplyStack[] {
  const map = new Map<number, number>();
  for (const stack of stacks) {
    if (stack.count <= 0) continue;
    map.set(stack.itemId, (map.get(stack.itemId) ?? 0) + stack.count);
  }
  return [...map.entries()].map(([itemId, count]) => ({ itemId, count }));
}

/**
 * Dry-run for UI: how much a hunt trip would cost without touching the pouch.
 * {@link packHuntSupplies} mutates character.supplies — never call that for display.
 */
export function estimatePackHuntSupplies(
  character: CharacterState,
  maxHours: number,
): { supplies: SupplyStack[]; cost: number; hours: number } {
  const snapshot: CharacterState = {
    ...character,
    supplies: (character.supplies ?? []).map((stack) => ({ ...stack })),
    warehouse: (character.warehouse ?? []).map((stack) => ({ ...stack })),
  };
  return packHuntSupplies(snapshot, maxHours);
}

/**
 * Fill the trip from the warehouse first, then buy the rest at NPC prices.
 *
 * Depot potions sitting unused while the character pays the shop again is the
 * opposite of how Tibia packing works. Warehouse stacks are consumed; gold
 * only covers what is still missing.
 */
export function packHuntSupplies(
  character: CharacterState,
  maxHours: number,
): { supplies: SupplyStack[]; cost: number; hours: number } {
  character.warehouse ??= [];
  const perHour = suppliesCost(defaultSupplies(character, 1));
  if (perHour <= 0) {
    const supplies = defaultSupplies(character, maxHours);
    return { supplies, cost: 0, hours: maxHours };
  }

  const coverValue = pocketCoverValue(character, defaultSupplies(character, 1));
  const buyPerHour = Math.max(0, perHour - coverValue);
  let hours = buyPerHour <= 0 ? maxHours : Math.min(maxHours, character.gold / buyPerHour);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const desired = defaultSupplies(character, hours);
    const takeFromSupplies: SupplyStack[] = [];
    const takeFromWarehouse: SupplyStack[] = [];
    const buy: SupplyStack[] = [];
    for (const stack of desired) {
      let remaining = stack.count;
      const supplyHave = stackCount(character.supplies, stack.itemId);
      const supplyTaken = Math.min(supplyHave, remaining);
      if (supplyTaken > 0) {
        takeFromSupplies.push({ itemId: stack.itemId, count: supplyTaken });
        remaining -= supplyTaken;
      }
      const depotHave = stackCount(character.warehouse, stack.itemId);
      const depotTaken = Math.min(depotHave, remaining);
      if (depotTaken > 0) {
        takeFromWarehouse.push({ itemId: stack.itemId, count: depotTaken });
        remaining -= depotTaken;
      }
      if (remaining > 0) buy.push({ itemId: stack.itemId, count: remaining });
    }
    const cost = suppliesCost(buy);
    if (cost <= character.gold) {
      for (const stack of takeFromSupplies) takeFromList(character.supplies, stack.itemId, stack.count);
      for (const stack of takeFromWarehouse) takeFromList(character.warehouse, stack.itemId, stack.count);
      const extras = character.supplies
        .filter((stack) => stack.count > 0)
        .map((stack) => ({ itemId: stack.itemId, count: stack.count }));
      character.supplies = [];
      return {
        supplies: mergeSupplyStacks([...takeFromSupplies, ...takeFromWarehouse, ...buy, ...extras]),
        cost,
        hours,
      };
    }
    hours *= 0.9;
  }
  return { supplies: [], cost: 0, hours: 0 };
}

function stackCount(list: Array<{ itemId: number; count: number }>, itemId: number): number {
  return list.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

function takeFromList(
  list: Array<{ itemId: number; count: number }>,
  itemId: number,
  count: number,
): number {
  const taken = takeItemStack(list, itemId, count);
  if (taken <= 0) return 0;
  const index = list.findIndex((entry) => entry.itemId === itemId);
  if (index >= 0 && list[index]!.count <= 0) list.splice(index, 1);
  return taken;
}

/** Gold value already sitting in the supply pouch + warehouse for one hour of defaults. */
function pocketCoverValue(character: CharacterState, needed: readonly SupplyStack[]): number {
  return warehouseCoverValue(character, needed) + supplyCoverValue(character, needed);
}

function supplyCoverValue(character: CharacterState, needed: readonly SupplyStack[]): number {
  character.supplies ??= [];
  let value = 0;
  for (const stack of needed) {
    const have = character.supplies.find((entry) => entry.itemId === stack.itemId)?.count ?? 0;
    value += supplyUnitCost(stack.itemId) * Math.min(have, stack.count);
  }
  return value;
}

function warehouseCoverValue(character: CharacterState, needed: readonly SupplyStack[]): number {
  let value = 0;
  for (const stack of needed) {
    const have = character.warehouse.find((entry) => entry.itemId === stack.itemId)?.count ?? 0;
    value += supplyUnitCost(stack.itemId) * Math.min(have, stack.count);
  }
  return value;
}
