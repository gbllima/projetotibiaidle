import { items, type Item } from '@tibia-idle/data';
import { canEquip, equipLevelRequired, slotFor } from './gear.js';
import { addWarehouseStack } from './loot.js';
import type { Rng } from './rng.js';
import type { CharacterState } from './types.js';

export const ROULETTE_SPIN_COST = 75;
export const ROULETTE_MIN_LEVEL = 80;
export const ROULETTE_MAX_LEVEL = 300;

const EXCLUDED_TYPES = new Set(['containers', 'decoration']);

/** Whether an item can appear on this vocation's roulette strip. */
export function rouletteItemEligible(item: Item, vocationId: number): boolean {
  const level = equipLevelRequired(item);
  if (level < ROULETTE_MIN_LEVEL || level > ROULETTE_MAX_LEVEL) return false;
  if (!slotFor(item)) return false;
  if (!item.hasSprite) return false;
  if (item.type && EXCLUDED_TYPES.has(item.type)) return false;
  const probe = { vocationId, level: ROULETTE_MAX_LEVEL } as CharacterState;
  return canEquip(item, probe);
}

/** Sorted equippable pool for one vocation (levels 80–300). */
export function roulettePool(vocationId: number): Item[] {
  return items
    .filter((item) => rouletteItemEligible(item, vocationId))
    .sort(
      (a, b) =>
        equipLevelRequired(a) - equipLevelRequired(b)
        || a.name.localeCompare(b.name, 'pt-BR'),
    );
}

export type RouletteSpinOk = {
  ok: true;
  itemId: number;
  itemName: string;
  levelRequired: number;
};

export type RouletteSpinFail = { ok: false; reason: string };

/** Spend 75 TC, pick a random vocation item, store it in the depot. */
export function spinRoulette(character: CharacterState, rng: Rng): RouletteSpinOk | RouletteSpinFail {
  if ((character.coins ?? 0) < ROULETTE_SPIN_COST) {
    return { ok: false, reason: `Precisa de ${ROULETTE_SPIN_COST} Tibia Coins.` };
  }
  const pool = roulettePool(character.vocationId);
  if (!pool.length) {
    return { ok: false, reason: 'Nenhum item disponível para sua vocação.' };
  }
  character.warehouse ??= [];
  const pick = pool[rng.uniform(0, pool.length - 1)]!;
  if (!addWarehouseStack(character.warehouse, pick.id, 1)) {
    return { ok: false, reason: 'Depot cheio — libere um slot antes de girar.' };
  }
  character.coins -= ROULETTE_SPIN_COST;
  return {
    ok: true,
    itemId: pick.id,
    itemName: pick.name,
    levelRequired: equipLevelRequired(pick),
  };
}
