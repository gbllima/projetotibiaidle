import { itemsById, type CombatType, type SkillName } from '@tibia-idle/data';
import { TICK_MS, type CharacterState, type EquipSlot, type HuntSession, type SimEvent, type WarehouseStack } from './types.js';
import { imbueAbsorbPercent } from './imbuements.js';

/**
 * Consumable jewellery as it works on Crystal / official Tibia.
 *
 * Duration rings tick only while worn on a hunt (the idle equivalent of
 * "equipped in the world"). Charge pieces spend a charge when they actually
 * absorb a matching hit. Amulet of Loss is consumed on an unprotected death
 * and keeps the loot pouch.
 *
 * Life / healing / time / energy / skill rings have empty `bonuses` in
 * items.xml — the engine stores those effects as duration, not attributes —
 * so this table is curated from the 15.25 item scripts, not generated.
 */

export type JewelryKind = 'duration' | 'charges' | 'untilDeath';

export interface JewelrySpec {
  itemId: number;
  slot: Extract<EquipSlot, 'ring' | 'necklace'>;
  kind: JewelryKind;
  durationMs?: number;
  charges?: number;
  /** Extra HP every 6 seconds, on top of vocation regen. */
  hpPerSix?: number;
  /** Extra mana every 6 seconds. */
  manaPerSix?: number;
  /** Multiplier on rangedExposure. Time ring is movement speed. */
  kite?: number;
  /** All incoming damage is paid from mana first. */
  magicShield?: boolean;
  skill?: { name: SkillName; bonus: number };
  /** Absorbs missing from items.xml (silver amulet, might-ring earth). */
  absorb?: Partial<Record<CombatType, number>>;
}

export const AMULET_OF_LOSS = 3057;
export const STONE_SKIN_AMULET = 3081;
export const MIGHT_RING = 3048;
export const LIFE_RING = 3052;
export const RING_OF_HEALING = 3098;
export const TIME_RING = 3053;
export const ENERGY_RING = 3051;

export const JEWELRY: readonly JewelrySpec[] = [
  { itemId: LIFE_RING, slot: 'ring', kind: 'duration', durationMs: 20 * 60_000, hpPerSix: 8, manaPerSix: 1 },
  { itemId: RING_OF_HEALING, slot: 'ring', kind: 'duration', durationMs: 7.5 * 60_000, hpPerSix: 12, manaPerSix: 3 },
  { itemId: TIME_RING, slot: 'ring', kind: 'duration', durationMs: 10 * 60_000, kite: 1 / 1.2 },
  { itemId: ENERGY_RING, slot: 'ring', kind: 'duration', durationMs: 20 * 60_000, magicShield: true },
  { itemId: 3091, slot: 'ring', kind: 'duration', durationMs: 30 * 60_000, skill: { name: 'sword', bonus: 4 } },
  { itemId: 3092, slot: 'ring', kind: 'duration', durationMs: 30 * 60_000, skill: { name: 'axe', bonus: 4 } },
  { itemId: 3093, slot: 'ring', kind: 'duration', durationMs: 30 * 60_000, skill: { name: 'club', bonus: 4 } },
  { itemId: 3050, slot: 'ring', kind: 'duration', durationMs: 30 * 60_000, skill: { name: 'fist', bonus: 4 } },
  { itemId: STONE_SKIN_AMULET, slot: 'necklace', kind: 'charges', charges: 5 },
  { itemId: MIGHT_RING, slot: 'ring', kind: 'charges', charges: 20, absorb: { COMBAT_EARTHDAMAGE: 20 } },
  { itemId: 3084, slot: 'necklace', kind: 'charges', charges: 250 },
  { itemId: 3054, slot: 'necklace', kind: 'charges', charges: 200, absorb: { COMBAT_EARTHDAMAGE: 10 } },
  { itemId: AMULET_OF_LOSS, slot: 'necklace', kind: 'untilDeath' },
];

export const jewelryById = new Map(JEWELRY.map((spec) => [spec.itemId, spec]));

const ABSORB_KEY: Partial<Record<CombatType, string>> = {
  COMBAT_PHYSICALDAMAGE: 'absorbpercentphysical',
  COMBAT_FIREDAMAGE: 'absorbpercentfire',
  COMBAT_ICEDAMAGE: 'absorbpercentice',
  COMBAT_EARTHDAMAGE: 'absorbpercentearth',
  COMBAT_ENERGYDAMAGE: 'absorbpercentenergy',
  COMBAT_HOLYDAMAGE: 'absorbpercentholy',
  COMBAT_DEATHDAMAGE: 'absorbpercentdeath',
};

export function jewelrySlot(itemId: number): EquipSlot | null {
  return jewelryById.get(itemId)?.slot ?? null;
}

export function jewelrySpec(itemId: number | undefined): JewelrySpec | null {
  if (!itemId) return null;
  return jewelryById.get(itemId) ?? null;
}

function durationTicks(ms: number): number {
  return Math.max(1, Math.round(ms / TICK_MS));
}

function sixSecondTicks(): number {
  return 6000 / TICK_MS;
}

function wornSpec(character: CharacterState, slot: EquipSlot): JewelrySpec | null {
  return jewelrySpec(character.equipment[slot]);
}

function remainingOk(character: CharacterState, spec: JewelrySpec): boolean {
  const slot = spec.slot;
  if (spec.kind === 'duration') return (character.equipmentDuration?.[slot] ?? 0) > 0;
  if (spec.kind === 'charges') return (character.equipmentCharges?.[slot] ?? 0) > 0;
  return character.equipment[slot] === spec.itemId;
}

export function bindJewelry(character: CharacterState, slot: EquipSlot, itemId: number): void {
  const spec = jewelryById.get(itemId);
  if (!spec || spec.slot !== slot) return;
  character.equipmentCharges ??= {};
  character.equipmentDuration ??= {};
  character.jewelryRemaining ??= {};
  const saved = character.jewelryRemaining[itemId];
  if (spec.kind === 'charges') {
    character.equipmentCharges[slot] = saved?.charges
      ?? spec.charges
      ?? itemsById.get(itemId)?.charges
      ?? 1;
  } else if (spec.kind === 'duration') {
    character.equipmentDuration[slot] = saved?.ticks ?? durationTicks(spec.durationMs ?? 60_000);
  }
  delete character.jewelryRemaining[itemId];
}

export function unbindJewelry(character: CharacterState, slot: EquipSlot): void {
  const itemId = character.equipment[slot];
  const spec = jewelrySpec(itemId);
  if (!itemId || !spec) {
    if (character.equipmentCharges) delete character.equipmentCharges[slot];
    if (character.equipmentDuration) delete character.equipmentDuration[slot];
    return;
  }
  character.jewelryRemaining ??= {};
  if (spec.kind === 'charges') {
    character.jewelryRemaining[itemId] = { charges: character.equipmentCharges?.[slot] };
  } else if (spec.kind === 'duration') {
    character.jewelryRemaining[itemId] = { ticks: character.equipmentDuration?.[slot] };
  }
  if (character.equipmentCharges) delete character.equipmentCharges[slot];
  if (character.equipmentDuration) delete character.equipmentDuration[slot];
}

/** Destroy the worn piece. Same item in the warehouse is equipped again, except AoL. */
export function destroyWornJewelry(
  character: CharacterState,
  slot: EquipSlot,
  emit?: (event: SimEvent) => void,
  tick = 0,
): void {
  const itemId = character.equipment[slot];
  const spec = jewelrySpec(itemId);
  if (!itemId) return;
  if (character.jewelryRemaining) delete character.jewelryRemaining[itemId];
  if (character.equipmentCharges) delete character.equipmentCharges[slot];
  if (character.equipmentDuration) delete character.equipmentDuration[slot];
  delete character.equipment[slot];
  emit?.({
    tick,
    type: 'buff',
    itemId,
    words: decayWords(itemId),
  });
  if (spec?.kind === 'untilDeath') return;
  character.warehouse ??= [];
  if (!takeOne(character.warehouse, itemId)) return;
  character.equipment[slot] = itemId;
  bindJewelry(character, slot, itemId);
}

function takeOne(list: WarehouseStack[], itemId: number): boolean {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || stack.count < 1) return false;
  stack.count -= 1;
  if (stack.count <= 0) {
    const index = list.indexOf(stack);
    if (index >= 0) list.splice(index, 1);
  }
  return true;
}

function decayWords(itemId: number): string {
  const name = itemsById.get(itemId)?.name ?? 'jewellery';
  return `Your ${name} loses its power.`;
}

export function tickJewelry(session: HuntSession, emit: (event: SimEvent) => void): void {
  const character = session.character;
  character.equipmentDuration ??= {};
  character.equipmentCharges ??= {};
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (!spec || spec.kind !== 'duration') continue;
    const left = (character.equipmentDuration[slot] ?? 0) - 1;
    character.equipmentDuration[slot] = left;
    if (left <= 0) destroyWornJewelry(character, slot, emit, session.tick);
  }
}

export function jewelryRegen(character: CharacterState): { health: number; mana: number } {
  let health = 0;
  let mana = 0;
  const scale = 1 / sixSecondTicks();
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (!spec || !remainingOk(character, spec)) continue;
    health += (spec.hpPerSix ?? 0) * scale;
    mana += (spec.manaPerSix ?? 0) * scale;
  }
  return { health, mana };
}

export function jewelryKite(character: CharacterState): number {
  let kite = 1;
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (!spec?.kite || !remainingOk(character, spec)) continue;
    kite *= spec.kite;
  }
  return kite;
}

export function jewelryMagicShield(character: CharacterState): boolean {
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (spec?.magicShield && remainingOk(character, spec)) return true;
  }
  return false;
}

export function jewelrySkillBonus(character: CharacterState, skill: SkillName): number {
  let bonus = 0;
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (!spec?.skill || spec.skill.name !== skill || !remainingOk(character, spec)) continue;
    bonus += spec.skill.bonus;
  }
  return bonus;
}

function pieceAbsorb(character: CharacterState, slot: EquipSlot, damageType: CombatType): number {
  const itemId = character.equipment[slot];
  if (!itemId) return 0;
  const spec = jewelrySpec(itemId);
  if (spec && !remainingOk(character, spec)) return 0;
  const item = itemsById.get(itemId);
  const key = ABSORB_KEY[damageType];
  const fromItem = (key ? item?.bonuses[key] ?? 0 : 0) + (item?.bonuses.absorbpercentall ?? 0);
  const extra = spec?.absorb?.[damageType] ?? 0;
  return fromItem + extra;
}

/**
 * Absorb percent from every worn piece, including charge jewellery.
 * Caps at 100 so stacked SSA + might ring cannot heal the player.
 */
export function absorbPercent(character: CharacterState, damageType: CombatType): number {
  let total = 0;
  for (const slot of Object.keys(character.equipment) as EquipSlot[]) {
    const itemId = character.equipment[slot];
    if (!itemId) continue;
    if (jewelryById.has(itemId)) {
      total += pieceAbsorb(character, slot, damageType);
      continue;
    }
    const item = itemsById.get(itemId);
    const key = ABSORB_KEY[damageType];
    total += (key ? item?.bonuses[key] ?? 0 : 0) + (item?.bonuses.absorbpercentall ?? 0);
  }
  total += imbueAbsorbPercent(character, damageType);
  return Math.max(0, Math.min(100, total));
}

/** Spend one charge on every charge piece that absorbed this hit. */
export function consumeJewelryCharges(
  session: HuntSession,
  damageType: CombatType,
  emit: (event: SimEvent) => void,
): void {
  const character = session.character;
  character.equipmentCharges ??= {};
  for (const slot of ['ring', 'necklace'] as const) {
    const spec = wornSpec(character, slot);
    if (!spec || spec.kind !== 'charges') continue;
    if (pieceAbsorb(character, slot, damageType) <= 0) continue;
    const left = (character.equipmentCharges[slot] ?? 0) - 1;
    character.equipmentCharges[slot] = left;
    if (left <= 0) destroyWornJewelry(character, slot, emit, session.tick);
  }
}

export function hasAmuletOfLoss(character: CharacterState): boolean {
  return character.equipment.necklace === AMULET_OF_LOSS;
}

export function consumeAmuletOfLoss(character: CharacterState): boolean {
  if (!hasAmuletOfLoss(character)) return false;
  if (character.jewelryRemaining) delete character.jewelryRemaining[AMULET_OF_LOSS];
  if (character.equipmentCharges) delete character.equipmentCharges.necklace;
  if (character.equipmentDuration) delete character.equipmentDuration.necklace;
  delete character.equipment.necklace;
  return true;
}

export function jewelryHud(character: CharacterState): {
  ring?: string;
  necklace?: string;
  ringLeft?: number;
  necklaceLeft?: number;
} {
  const ringId = character.equipment.ring;
  const neckId = character.equipment.necklace;
  const ring = ringId ? itemsById.get(ringId)?.name : undefined;
  const necklace = neckId ? itemsById.get(neckId)?.name : undefined;
  const ringSpec = jewelrySpec(ringId);
  const neckSpec = jewelrySpec(neckId);
  return {
    ring,
    necklace,
    ringLeft: ringSpec?.kind === 'charges'
      ? character.equipmentCharges?.ring
      : ringSpec?.kind === 'duration'
        ? character.equipmentDuration?.ring
        : undefined,
    necklaceLeft: neckSpec?.kind === 'charges'
      ? character.equipmentCharges?.necklace
      : neckSpec?.kind === 'duration'
        ? character.equipmentDuration?.necklace
        : undefined,
  };
}

/** Warehouse refill helper used by tests and the auto-replace path. */
export function stashJewelry(character: CharacterState, itemId: number, count = 1): void {
  character.warehouse ??= [];
  const stack = character.warehouse.find((entry) => entry.itemId === itemId);
  if (stack) stack.count += count;
  else character.warehouse.push({ itemId, count });
}
