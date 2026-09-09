import { getVocation, items, itemsById, wandsById, type Item } from '@tibia-idle/data';
import { jewelrySlot } from './jewelry.js';
import type { CharacterState, EquipSlot } from './types.js';

/** Default brown backpack every new character wears. */
export const DEFAULT_BACKPACK_ID = 2854;

/**
 * Gear selection.
 *
 * Used for auto-equip in game and to build reference loadouts for calibration.
 * The scoring is intentionally simple - it picks the strongest item a character
 * can legally wear - because the interesting decisions in an idle game are
 * which hunt to run and how to spend supplies, not which of two near-identical
 * helmets to click.
 */

/**
 * The slot an item occupies.
 *
 * Most equipment in items.xml carries no `slot` attribute at all - a crown
 * armor only says `primarytype="armors"` - so the market category is the
 * reliable signal and `slot` is only a fallback.
 */
const TYPE_SLOT: Record<string, EquipSlot> = {
  armors: 'armor',
  helmets: 'head',
  legs: 'legs',
  boots: 'feet',
  'amulets and necklaces': 'necklace',
  rings: 'ring',
  shields: 'right',
  spellbooks: 'right',
  quivers: 'right',
  containers: 'backpack',
  'sword weapons': 'left',
  'axe weapons': 'left',
  'club weapons': 'left',
  'distance weapons': 'left',
  wands: 'left',
  rods: 'left',
  ammunition: 'ammo',
  'creature products': 'ammo',
};

const SLOT_FALLBACK: Record<string, EquipSlot> = {
  head: 'head',
  armor: 'armor',
  legs: 'legs',
  feet: 'feet',
  necklace: 'necklace',
  ring: 'ring',
  backpack: 'backpack',
  ammo: 'ammo',
  shield: 'right',
  hand: 'left',
  'right-hand': 'left',
  'two-handed': 'left',
};

export function slotFor(item: Item): EquipSlot | null {
  const jewel = jewelrySlot(item.id);
  if (jewel) return jewel;
  if (item.weaponType === 'shield' || item.weaponType === 'spellbook') return 'right';
  if (item.weaponType === 'ammo' || item.weaponType === 'ammunition' || item.weaponType === 'missile') {
    return 'ammo';
  }
  if (item.type && TYPE_SLOT[item.type]) return TYPE_SLOT[item.type] as EquipSlot;
  if (item.weaponType) return 'left';
  if (item.slot && SLOT_FALLBACK[item.slot]) return SLOT_FALLBACK[item.slot] as EquipSlot;
  return null;
}

/**
 * What a piece is worth in gold.
 *
 * Many items have no NPC buy price because they only drop, so the sell price
 * stands in. Doubling it approximates the premium a player pays on the market.
 */
export function itemCost(item: Item): number {
  if (item.buyPrice !== null) return item.buyPrice;
  if (item.sellPrice !== null) return item.sellPrice * 2;
  return 0;
}

/** A two-handed weapon blocks the shield slot. */
export function isTwoHanded(item: Item): boolean {
  return item.slot === 'two-handed';
}

const VOCATION_ALIASES: Record<number, string[]> = {
  1: ['sorcerer', 'master sorcerer'],
  2: ['druid', 'elder druid'],
  3: ['paladin', 'royal paladin'],
  4: ['knight', 'elite knight'],
  5: ['sorcerer', 'master sorcerer'],
  6: ['druid', 'elder druid'],
  7: ['paladin', 'royal paladin'],
  8: ['knight', 'elite knight'],
  9: ['monk', 'exalted monk'],
  10: ['monk', 'exalted monk'],
};

/** Weapon types a vocation can actually fight with. Rods share `weaponType=wand`. */
export function weaponFamily(vocationId: number): readonly string[] {
  switch (vocationId) {
    case 1: case 5: return ['wand'];
    case 2: case 6: return ['wand'];
    case 3: case 7: return ['distance'];
    case 9: case 10: return ['fist'];
    default: return ['sword', 'axe', 'club'];
  }
}

/**
 * Level required to equip, from items.xml / wands.xml only.
 * Zero means any level may wear it.
 */
export function equipLevelRequired(item: Item): number {
  const wand = wandsById.get(item.id);
  if (wand && wand.levelRequired > 0) return wand.levelRequired;
  return item.levelRequired > 0 ? item.levelRequired : 0;
}

/** @deprecated Use equipLevelRequired — kept for older imports. */
export function effectiveLevelRequirement(item: Item): number {
  return equipLevelRequired(item);
}

export function canEquipFor(item: Item, vocationId: number, level: number): boolean {
  if (equipLevelRequired(item) > level) return false;
  if (item.vocations.length === 0) return true;
  const aliases = VOCATION_ALIASES[vocationId] ?? [];
  return item.vocations.some((v) => aliases.includes(v));
}

export function canEquip(item: Item, character: CharacterState): boolean {
  return canEquipFor(item, character.vocationId, character.level);
}

/**
 * Gold a character of this level can plausibly have sunk into gear. Used as
 * the default budget so progression feels earned rather than handed over.
 */
export function gearBudget(level: number): number {
  return Math.round(200 * level ** 1.8);
}

/** Higher is better. Offense is weighted above defense for weapons. */
function score(item: Item, slot: EquipSlot, preferMagic: boolean): number {
  if (slot === 'left') {
    if (preferMagic) {
      const wand = wandsById.get(item.id);
      return (item.bonuses['magiclevelpoints'] ?? 0) * 50 + (wand?.toDamage ?? item.attack);
    }
    return item.attack * 10 + item.defense;
  }
  if (slot === 'right') return item.defense * 10 + (item.bonuses['magiclevelpoints'] ?? 0) * 20;
  if (slot === 'ammo') return item.attack;

  let value = item.armor * 10;
  for (const [key, bonus] of Object.entries(item.bonuses)) {
    value += key === 'magiclevelpoints' ? bonus * 30 : bonus * 5;
  }
  return value;
}

/**
 * Best affordable loadout for a character.
 *
 * `budget` caps the NPC buy price of any single piece so low level characters
 * are not handed endgame gear. Pass `Infinity` for a theoretical best-in-slot.
 */
export function bestLoadout(
  character: CharacterState,
  budget = gearBudget(character.level),
): Partial<Record<EquipSlot, number>> {
  const vocation = getVocation(character.vocationId);
  const preferMagic = [1, 2, 5, 6].includes(vocation.id);
  const best = new Map<EquipSlot, { item: Item; value: number }>();

  const wantsDistance = [3, 7].includes(vocation.id);

  for (const item of items) {
    const slot = slotFor(item);
    if (!slot || !canEquip(item, character)) continue;
    if (itemCost(item) > budget) continue;

    if (slot === 'left') {
      if (preferMagic) {
        const rod = item.type === 'rods' || /\brod\b/i.test(item.name);
        if (item.weaponType !== 'wand') continue;
        if ([2, 6].includes(vocation.id) && !rod) continue;
        if ([1, 5].includes(vocation.id) && rod) continue;
      } else if (!weaponFamily(vocation.id).includes(item.weaponType ?? '')) continue;
    }
    // Ammunition only makes sense alongside a bow or crossbow.
    if (slot === 'ammo' && (!wantsDistance || item.attack <= 0)) continue;

    const value = score(item, slot, preferMagic);
    if (value <= 0) continue;
    const current = best.get(slot);
    if (!current || value > current.value) best.set(slot, { item, value });
  }

  const loadout: Partial<Record<EquipSlot, number>> = {};
  for (const [slot, entry] of best) loadout[slot] = entry.item.id;

  const weaponId = loadout.left;
  const weapon = weaponId === undefined ? null : itemsById.get(weaponId);
  if (weapon && isTwoHanded(weapon)) delete loadout.right;

  return loadout;
}

/** Total NPC buy price of a loadout, for showing gear cost in the UI. */
export function loadoutCost(loadout: Partial<Record<EquipSlot, number>>): number {
  let total = 0;
  for (const id of Object.values(loadout)) {
    if (id !== undefined) total += itemsById.get(id)?.buyPrice ?? 0;
  }
  return total;
}
