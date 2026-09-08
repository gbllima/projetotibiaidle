import { itemsById } from '@tibia-idle/data';
import { canEquip, isTwoHanded, slotFor } from './gear.js';
import {
  FORGE_CONVERGENCE_FUSION_DUST_COST,
  FORGE_CONVERGENCE_TRANSFER_DUST_COST,
  FORGE_FUSION_DUST_COST,
  FORGE_TIER_LOSS_REDUCTION,
  FORGE_TRANSFER_DUST_COST,
  forgeFusionSuccessChance,
  forgeTierPrice,
} from './forge.js';
import { bindJewelry, unbindJewelry } from './jewelry.js';
import { moveStackToBackpack } from './inventory.js';
import { addItemStack } from './loot.js';
import { gearTier } from './procs.js';
import { Rng } from './rng.js';
import type { CharacterState, EquipSlot } from './types.js';

export const EXALT_TIER_CAP = 10;

/**
 * Classification shown/spent by the forge UI.
 * Missing stored tier counts as 0 (paperdoll starts unexalted).
 */
export function forgeSlotTier(character: CharacterState, slot: EquipSlot): number {
  const stored = character.equipmentTiers?.[slot];
  if (stored === undefined) return 0;
  return Math.min(EXALT_TIER_CAP, Math.max(0, Math.floor(stored)));
}

/** Gold to raise a slot from `tier` to `tier + 1` (idle sink alongside Crystal dust). */
export function exaltCost(tier: number): number {
  return Math.round(4_000 * 2.15 ** Math.max(0, Math.min(EXALT_TIER_CAP - 1, tier)));
}

/** Crystal fusion always spends a flat 100 dust per classification step. */
export function exaltDustCost(_tier = 0): number {
  return FORGE_FUSION_DUST_COST;
}

export type ExaltOptions = {
  /** Spend 1 exalted core for +15% success (Crystal forgeBonusSuccessRate). */
  useCore?: boolean;
  /**
   * Spend a second core so fail only has 50% chance to drop a tier
   * (Crystal forgeTierLossReduction). Idle proxy: no duplicate item is sacrificed —
   * on fail the worn piece itself may lose one classification.
   */
  reduceTierLoss?: boolean;
};

export type ExaltOk = {
  ok: true;
  success: boolean;
  tier: number;
  previousTier: number;
  cost: number;
  dustCost: number;
  coresSpent: number;
  tierLost: boolean;
  successChance: number;
};

export type EquipFail = { ok: false; reason: string };
export type EquipOk = { ok: true; slot: EquipSlot; displaced: number[] };

export type ConvergenceFuseOk = {
  ok: true;
  tier: number;
  previousTier: number;
  cost: number;
  dustCost: number;
};

export type TransferOk = {
  ok: true;
  donorSlot: EquipSlot;
  receiveSlot: EquipSlot;
  donorTier: number;
  receiveTier: number;
  cost: number;
  dustCost: number;
  coresSpent: number;
  convergence: boolean;
};

/**
 * Put a wearable item on the paperdoll.
 *
 * The piece that was there — and a shield, if the new weapon is two-handed —
 * goes to the worn backpack (depot fallback if full). Callers already removed
 * the incoming item from pouch, backpack, or warehouse.
 */
function storeDisplacedGear(character: CharacterState, itemId: number): void {
  character.backpackContents ??= [];
  character.warehouse ??= [];
  const moved = moveStackToBackpack(character, itemId, 1);
  if (!moved.ok) addItemStack(character.warehouse, itemId, 1);
}
export function wearItem(character: CharacterState, itemId: number): EquipOk | EquipFail {
  const item = itemsById.get(itemId);
  if (!item) return { ok: false, reason: 'Unknown item.' };
  const slot = slotFor(item);
  if (!slot) return { ok: false, reason: 'That item cannot be equipped.' };
  if (!canEquip(item, character)) {
    return { ok: false, reason: 'Your vocation or level cannot wear that.' };
  }

  const displaced: number[] = [];
  const current = character.equipment[slot];
  if (current && current !== itemId) {
    unbindJewelry(character, slot);
    displaced.push(current);
    if (character.equipmentTiers) delete character.equipmentTiers[slot];
  }

  if (slot === 'left' && isTwoHanded(item) && character.equipment.right) {
    unbindJewelry(character, 'right');
    displaced.push(character.equipment.right);
    delete character.equipment.right;
    if (character.equipmentTiers) delete character.equipmentTiers.right;
  }
  if (slot === 'right' && character.equipment.left) {
    const weapon = itemsById.get(character.equipment.left);
    if (weapon && isTwoHanded(weapon)) {
      unbindJewelry(character, 'left');
      displaced.push(character.equipment.left);
      delete character.equipment.left;
      if (character.equipmentTiers) delete character.equipmentTiers.left;
    }
  }

  character.equipment[slot] = itemId;
  bindJewelry(character, slot, itemId);
  for (const id of displaced) storeDisplacedGear(character, id);
  return { ok: true, slot, displaced };
}

export function removeWorn(character: CharacterState, slot: EquipSlot): { ok: true; itemId: number } | EquipFail {
  const itemId = character.equipment[slot];
  if (!itemId) return { ok: false, reason: 'That slot is empty.' };
  if (slot === 'backpack' && (character.backpackContents?.length ?? 0) > 0) {
    return { ok: false, reason: 'Esvazie a backpack antes de desequipar.' };
  }
  unbindJewelry(character, slot);
  delete character.equipment[slot];
  if (character.equipmentTiers) delete character.equipmentTiers[slot];
  storeDisplacedGear(character, itemId);
  return { ok: true, itemId };
}

/**
 * Spend forge dust (+ idle gold, optional cores) on a Crystal-style fusion attempt.
 * Onslaught / Ruse / Amplification read `equipmentTiers`.
 *
 * Idle proxy: no duplicate sacrifice item — fail may drop the worn slot's tier
 * (always without the reduce core; 50% with it when tier ≥ 1).
 */
export function exaltSlot(
  character: CharacterState,
  slot: EquipSlot,
  options: ExaltOptions = {},
  rng?: Rng,
): ExaltOk | EquipFail {
  if (!character.equipment[slot]) return { ok: false, reason: 'Equip something in that slot first.' };
  const current = gearTier(character, slot);
  if (current >= EXALT_TIER_CAP) return { ok: false, reason: 'That piece is already classification 10.' };

  const useCore = Boolean(options.useCore);
  const reduceTierLoss = Boolean(options.reduceTierLoss);
  const coresNeeded = (useCore ? 1 : 0) + (reduceTierLoss ? 1 : 0);
  const dustCost = exaltDustCost(current);
  const cost = exaltCost(current);
  const successChance = forgeFusionSuccessChance(useCore);

  character.forgeDust ??= 0;
  character.forgeCores ??= 0;
  if (character.forgeDust < dustCost) {
    return { ok: false, reason: `Need ${dustCost} forge dust.` };
  }
  if (character.gold < cost) return { ok: false, reason: `Need ${cost.toLocaleString('pt-BR')} gold.` };
  if (character.forgeCores < coresNeeded) {
    return { ok: false, reason: coresNeeded === 1 ? 'Need 1 exalted core.' : `Need ${coresNeeded} exalted cores.` };
  }

  character.forgeDust -= dustCost;
  character.gold -= cost;
  character.forgeCores -= coresNeeded;
  character.equipmentTiers ??= {};

  // Crystal: uniform_random(1, 100) <= base + bonusCore.
  const roller = rng ?? new Rng(
    BigInt(Date.now())
      ^ (BigInt(character.gold & 0xffffffff) << 17n)
      ^ BigInt(((character.forgeDust ?? 0) + 1) * 0x9e37),
  );
  const success = roller.uniform(1, 100) <= successChance;

  let tierLost = false;
  let tier = current;
  if (success) {
    tier = current + 1;
    character.equipmentTiers[slot] = tier;
  } else {
    // Without the reduce core, Crystal always loses the sacrifice tier (≥1).
    const lossChance = reduceTierLoss ? FORGE_TIER_LOSS_REDUCTION : 100;
    if (current >= 1 && roller.uniform(1, 100) <= lossChance) {
      tier = current - 1;
      tierLost = true;
    }
    character.equipmentTiers[slot] = tier;
  }

  return {
    ok: true,
    success,
    tier,
    previousTier: current,
    cost,
    dustCost,
    coresSpent: coresNeeded,
    tierLost,
    successChance,
  };
}

/**
 * Crystal convergence fusion: guaranteed +1 classification.
 * Dust 130 + class-4 convergenceFusion gold for the target tier. No cores / no fail.
 */
export function convergenceFuseSlot(
  character: CharacterState,
  slot: EquipSlot,
): ConvergenceFuseOk | EquipFail {
  if (!character.equipment[slot]) return { ok: false, reason: 'Equip something in that slot first.' };
  const current = forgeSlotTier(character, slot);
  if (current >= EXALT_TIER_CAP) return { ok: false, reason: 'That piece is already classification 10.' };
  const target = current + 1;
  const price = forgeTierPrice(target);
  if (!price) return { ok: false, reason: 'Unknown forge tier price.' };

  const dustCost = FORGE_CONVERGENCE_FUSION_DUST_COST;
  const cost = price.convergenceFusion;
  character.forgeDust ??= 0;
  if (character.forgeDust < dustCost) return { ok: false, reason: `Need ${dustCost} forge dust.` };
  if (character.gold < cost) return { ok: false, reason: `Need ${cost.toLocaleString('pt-BR')} gold.` };

  character.forgeDust -= dustCost;
  character.gold -= cost;
  character.equipmentTiers ??= {};
  character.equipmentTiers[slot] = target;
  return { ok: true, tier: target, previousTier: current, cost, dustCost };
}

/**
 * Crystal tier transfer between two worn slots (idle proxy — no duplicate items).
 *
 * Normal: receiver (tier 0) gets donorTier − 1; donor becomes 0. Dust 100.
 * Convergence: receiver gets full donor tier; dust 160.
 * Gold + cores priced from class-4 table at the resulting `toTier`.
 */
export function transferSlotTier(
  character: CharacterState,
  donorSlot: EquipSlot,
  receiveSlot: EquipSlot,
  convergence = false,
): TransferOk | EquipFail {
  if (donorSlot === receiveSlot) return { ok: false, reason: 'Pick two different slots.' };
  if (!character.equipment[donorSlot]) return { ok: false, reason: 'Donor slot is empty.' };
  if (!character.equipment[receiveSlot]) return { ok: false, reason: 'Receiver slot is empty.' };

  const donorTier = forgeSlotTier(character, donorSlot);
  const receiveTier = forgeSlotTier(character, receiveSlot);
  if (receiveTier !== 0) return { ok: false, reason: 'Receiver must be classification 0.' };
  if (convergence) {
    if (donorTier < 1) return { ok: false, reason: 'Donor needs classification 1+.' };
  } else if (donorTier < 2) {
    return { ok: false, reason: 'Normal transfer needs donor classification 2+ (result is tier − 1).' };
  }

  const toTier = convergence ? donorTier : donorTier - 1;
  const price = forgeTierPrice(toTier);
  if (!price || toTier < 1) return { ok: false, reason: 'Unknown forge tier price.' };

  const dustCost = convergence ? FORGE_CONVERGENCE_TRANSFER_DUST_COST : FORGE_TRANSFER_DUST_COST;
  const cost = convergence ? price.convergenceTransfer : price.regular;
  const coresSpent = price.cores;

  character.forgeDust ??= 0;
  character.forgeCores ??= 0;
  if (character.forgeDust < dustCost) return { ok: false, reason: `Need ${dustCost} forge dust.` };
  if (character.gold < cost) return { ok: false, reason: `Need ${cost.toLocaleString('pt-BR')} gold.` };
  if (character.forgeCores < coresSpent) {
    return { ok: false, reason: coresSpent === 1 ? 'Need 1 exalted core.' : `Need ${coresSpent} exalted cores.` };
  }

  character.forgeDust -= dustCost;
  character.gold -= cost;
  character.forgeCores -= coresSpent;
  character.equipmentTiers ??= {};
  character.equipmentTiers[donorSlot] = 0;
  character.equipmentTiers[receiveSlot] = toTier;

  return {
    ok: true,
    donorSlot,
    receiveSlot,
    donorTier: 0,
    receiveTier: toTier,
    cost,
    dustCost,
    coresSpent,
    convergence,
  };
}
