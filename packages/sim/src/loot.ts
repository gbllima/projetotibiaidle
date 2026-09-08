import { itemsById, type Item } from '@tibia-idle/data';
import { deriveStats } from './character.js';
import { DEPOT_SLOT_CAP, LOOT_SLOT_DEFAULT } from './progression.js';
import type { CharacterState, HuntSession, WarehouseStack } from './types.js';

/** Crystal coin denominations. Sell price is preferred when the item has one. */
const MONEY_UNITS: Record<string, number> = {
  'gold coin': 1,
  'platinum coin': 100,
  'crystal coin': 10000,
};

export function isMoneyItem(item: Item | undefined): boolean {
  if (!item) return false;
  return Object.hasOwn(MONEY_UNITS, item.name.toLowerCase());
}

export function moneyUnitValue(item: Item): number {
  return item.sellPrice ?? MONEY_UNITS[item.name.toLowerCase()] ?? 0;
}

export function pouchSellValue(session: HuntSession): number {
  let gold = 0;
  for (const [id, count] of Object.entries(session.totals.lootByItem)) {
    const item = itemsById.get(Number(id));
    const unit = item ? (isMoneyItem(item) ? moneyUnitValue(item) : (item.sellPrice ?? 0)) : 0;
    gold += unit * count;
  }
  return gold;
}

/** Whether a new stack can occupy a loot-pouch slot. Existing stacks always grow. */
export function pouchHasRoom(session: HuntSession, itemId: number): boolean {
  if (session.totals.lootByItem[itemId]) return true;
  const used = Object.keys(session.totals.lootByItem).length;
  return used < (session.character.lootSlots ?? LOOT_SLOT_DEFAULT);
}

/** Item weight in hundredths of an ounce, matching Crystal `item.weight`. */
export function itemWeight(itemId: number): number {
  return itemsById.get(itemId)?.weight ?? 0;
}

export function stackWeight(itemId: number, count: number): number {
  return itemWeight(itemId) * Math.max(0, count);
}

/** Supplies + pouch + equipped gear. HUD weight readout. */
export function carriedWeight(character: CharacterState, lootByItem: Record<number, number> = {}): number {
  let weight = 0;
  for (const stack of character.supplies ?? []) weight += stackWeight(stack.itemId, stack.count);
  for (const stack of character.backpackContents ?? []) weight += stackWeight(stack.itemId, stack.count);
  for (const [id, count] of Object.entries(lootByItem)) weight += stackWeight(Number(id), count);
  for (const id of Object.values(character.equipment ?? {})) {
    if (id !== undefined) weight += itemWeight(id);
  }
  return weight;
}

export function sessionWeight(session: HuntSession): number {
  return carriedWeight(session.character, session.totals.lootByItem);
}

export function canCarry(session: HuntSession, itemId: number, count: number): boolean {
  const cap = deriveStats(session.character).capacity;
  return sessionWeight(session) + stackWeight(itemId, count) <= cap;
}

export function addItemStack(list: WarehouseStack[], itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (stack) stack.count += count;
  else list.push({ itemId, count });
}

/** Whether a new stack can occupy a depot slot. Existing stacks always grow. */
export function warehouseHasRoom(warehouse: WarehouseStack[], itemId: number): boolean {
  if (warehouse.some((entry) => entry.itemId === itemId)) return true;
  return warehouse.length < DEPOT_SLOT_CAP;
}

/** Add to depot; returns how many were stored (0 when no free slot for a new stack). */
export function addWarehouseStack(list: WarehouseStack[], itemId: number, count: number): number {
  if (count <= 0) return 0;
  const stack = list.find((entry) => entry.itemId === itemId);
  if (stack) {
    stack.count += count;
    return count;
  }
  if (list.length >= DEPOT_SLOT_CAP) return 0;
  list.push({ itemId, count });
  return count;
}

/** Remove up to `count` from a stack. Returns how many were actually taken. */
export function takeItemStack(list: WarehouseStack[], itemId: number, count: number): number {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || count <= 0) return 0;
  const taken = Math.min(stack.count, count);
  stack.count -= taken;
  if (stack.count <= 0) {
    const index = list.indexOf(stack);
    if (index >= 0) list.splice(index, 1);
  }
  return taken;
}

/**
 * Unprotected death: drop a fraction of each pouch stack.
 * Returns the gold value that vanished.
 */
export function dropPouchFraction(session: HuntSession, fraction: number): number {
  const rate = Math.min(1, Math.max(0, fraction));
  if (rate <= 0) return 0;
  let lostGold = 0;
  for (const [id, count] of Object.entries(session.totals.lootByItem)) {
    const drop = Math.floor(count * rate);
    if (drop <= 0) continue;
    const itemId = Number(id);
    const left = count - drop;
    if (left <= 0) delete session.totals.lootByItem[itemId];
    else session.totals.lootByItem[itemId] = left;
    const item = itemsById.get(itemId);
    const unit = item ? (isMoneyItem(item) ? moneyUnitValue(item) : (item.sellPrice ?? 0)) : 0;
    lostGold += unit * drop;
  }
  session.totals.lootValue = Math.max(0, session.totals.lootValue - lostGold);
  return lostGold;
}

/** Move pouch stacks into the depot. Coins never sit here — they already banked. */
export function movePouchToWarehouse(session: HuntSession): number {
  session.character.warehouse ??= [];
  let items = 0;
  const remaining: Record<number, number> = {};
  for (const [id, count] of Object.entries(session.totals.lootByItem)) {
    const itemId = Number(id);
    const moved = addWarehouseStack(session.character.warehouse, itemId, count);
    items += moved;
    if (moved < count) remaining[itemId] = count - moved;
  }
  session.totals.lootByItem = remaining;
  return items;
}
