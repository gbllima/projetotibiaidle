import { itemsById } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import {
  canEquip, convergenceFuseSlot, createCharacter, exaltCost, exaltSlot, equipLevelRequired, forgeFusionSuccessChance,
  forgeTierPrice, FORGE_CONVERGENCE_FUSION_DUST_COST, FORGE_CONVERGENCE_TRANSFER_DUST_COST,
  FORGE_TRANSFER_DUST_COST, slotFor, transferSlotTier, wearItem, removeWorn, Rng,
} from '../src/index.js';

describe('manual gear', () => {
  it('allows plate armor at low level when items.xml has no level gate', () => {
    const character = createCharacter('Kina', 4);
    character.level = 8;
    const plate = itemsById.get(3357);
    expect(plate?.name).toBe('plate armor');
    expect(plate?.levelRequired).toBe(0);
    expect(equipLevelRequired(plate!)).toBe(0);
    expect(canEquip(plate!, character)).toBe(true);
    expect(wearItem(character, plate!.id).ok).toBe(true);
    expect(character.equipment.armor).toBe(plate!.id);
  });

  it('blocks items that declare a level requirement in items.xml', () => {
    const character = createCharacter('Kina', 4);
    character.level = 10;
    const axe = itemsById.get(665);
    expect(axe?.name).toBe('fiery barbarian axe');
    expect(axe?.levelRequired).toBe(20);
    expect(canEquip(axe!, character)).toBe(false);
    expect(wearItem(character, axe!.id).ok).toBe(false);
  });

  it('wears a piece and sends the replaced gear to the backpack', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    const plate = [...itemsById.values()].find((item) => item.name === 'plate armor' && canEquip(item, character));
    const chain = [...itemsById.values()].find((item) => item.name === 'chain armor' && canEquip(item, character));
    expect(plate).toBeDefined();
    expect(chain).toBeDefined();
    expect(slotFor(plate!)).toBe('armor');

    const previous = character.equipment.armor;
    const result = wearItem(character, plate!.id);
    expect(result.ok).toBe(true);
    expect(character.equipment.armor).toBe(plate!.id);
    if (previous) {
      expect(character.backpackContents.some((stack) => stack.itemId === previous)).toBe(true);
    }

    const swap = wearItem(character, chain!.id);
    expect(swap.ok).toBe(true);
    expect(character.equipment.armor).toBe(chain!.id);
    expect(character.backpackContents.some((stack) => stack.itemId === plate!.id)).toBe(true);
  });

  it('swaps knight weapons into the backpack', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    const sword = itemsById.get(3271);
    const axe = itemsById.get(3266);
    expect(sword?.weaponType).toBe('sword');
    expect(axe?.weaponType).toBe('axe');
    expect(wearItem(character, sword!.id).ok).toBe(true);
    expect(wearItem(character, axe!.id).ok).toBe(true);
    expect(character.equipment.left).toBe(axe!.id);
    expect(character.backpackContents.some((stack) => stack.itemId === sword!.id)).toBe(true);
  });

  it('unequips into the backpack', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    const plate = [...itemsById.values()].find((item) => item.name === 'plate armor' && canEquip(item, character));
    expect(plate).toBeDefined();
    expect(wearItem(character, plate!.id).ok).toBe(true);
    const result = removeWorn(character, 'armor');
    expect(result.ok).toBe(true);
    expect(character.equipment.armor).toBeUndefined();
    expect(character.backpackContents.some((stack) => stack.itemId === plate!.id)).toBe(true);
  });
});

describe('exaltation', () => {
  it('charges forge dust and gold, then raises classification on success', () => {
    const slot = 'armor' as const;
    let raised = false;
    for (let seed = 1n; seed <= 80n; seed += 1n) {
      const character = createCharacter('Kina', 4);
      character.level = 200;
      character.gold = 1_000_000;
      character.forgeDust = 250;
      character.forgeDustLevel = 225;
      character.equipmentTiers = { [slot]: 0 };
      const piece = [...itemsById.values()].find((item) => slotFor(item) === slot && canEquip(item, character));
      expect(piece).toBeDefined();
      character.equipment[slot] = piece!.id;
      const cost = exaltCost(0);
      const result = exaltSlot(character, slot, {}, new Rng(seed));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.dustCost).toBe(100);
      expect(character.gold).toBe(1_000_000 - result.cost);
      expect(character.forgeDust).toBe(150);
      if (result.success) {
        expect(result.cost).toBeGreaterThanOrEqual(cost);
        expect(character.equipmentTiers[slot]).toBe(1);
        expect(result.tier).toBe(1);
        raised = true;
        break;
      }
      expect(character.equipmentTiers[slot]).toBe(0);
    }
    expect(raised).toBe(true);
  });

  it('spends a success core for 65% chance and can drop tier on fail', () => {
    expect(forgeFusionSuccessChance(false)).toBe(50);
    expect(forgeFusionSuccessChance(true)).toBe(65);

    const character = createCharacter('Kina', 4);
    character.level = 80;
    character.gold = 1_000_000;
    character.forgeDust = 500;
    character.forgeDustLevel = 225;
    character.forgeCores = 5;
    character.equipmentTiers = { armor: 2 };
    const piece = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character));
    character.equipment.armor = piece!.id;

    let sawFailLoss = false;
    for (let seed = 1n; seed <= 120n; seed += 1n) {
      const copy = structuredClone(character);
      const result = exaltSlot(copy, 'armor', { useCore: true }, new Rng(seed));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.coresSpent).toBe(1);
      expect(result.successChance).toBe(65);
      expect(copy.forgeCores).toBe(4);
      if (!result.success && result.tierLost) {
        expect(copy.equipmentTiers.armor).toBe(1);
        sawFailLoss = true;
        break;
      }
    }
    expect(sawFailLoss).toBe(true);
  });

  it('refuses exalt without dust', () => {
    const character = createCharacter('Kina', 4);
    character.level = 200;
    character.gold = 1_000_000;
    character.forgeDust = 0;
    character.equipment.armor = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character))!.id;
    const result = exaltSlot(character, 'armor', {}, new Rng(1n));
    expect(result.ok).toBe(false);
  });

  it('convergence fusion always raises tier for class-4 gold + 130 dust', () => {
    const character = createCharacter('Kina', 4);
    character.level = 100;
    character.gold = 60_000_000;
    character.forgeDust = 200;
    character.forgeDustLevel = 225;
    character.equipmentTiers = { armor: 0 };
    character.equipment.armor = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character))!.id;
    const price = forgeTierPrice(1)!;
    const result = convergenceFuseSlot(character, 'armor');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tier).toBe(1);
      expect(result.dustCost).toBe(FORGE_CONVERGENCE_FUSION_DUST_COST);
      expect(result.cost).toBe(price.convergenceFusion);
      expect(character.equipmentTiers.armor).toBe(1);
      expect(character.forgeDust).toBe(70);
      expect(character.gold).toBe(60_000_000 - price.convergenceFusion);
    }
  });

  it('transfers tier−1 between worn slots and spends class-4 cores', () => {
    const character = createCharacter('Kina', 4);
    character.level = 100;
    character.gold = 30_000_000;
    character.forgeDust = 200;
    character.forgeDustLevel = 225;
    character.forgeCores = 5;
    const armor = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character))!;
    const helmet = [...itemsById.values()].find((item) => slotFor(item) === 'head' && canEquip(item, character))!;
    character.equipment.armor = armor.id;
    character.equipment.head = helmet.id;
    character.equipmentTiers = { armor: 3, head: 0 };
    const price = forgeTierPrice(2)!;
    const result = transferSlotTier(character, 'armor', 'head', false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receiveTier).toBe(2);
      expect(result.donorTier).toBe(0);
      expect(result.dustCost).toBe(FORGE_TRANSFER_DUST_COST);
      expect(result.coresSpent).toBe(price.cores);
      expect(result.cost).toBe(price.regular);
      expect(character.equipmentTiers.armor).toBe(0);
      expect(character.equipmentTiers.head).toBe(2);
      expect(character.forgeCores).toBe(5 - price.cores);
    }
  });

  it('convergence transfer moves the full donor tier', () => {
    const character = createCharacter('Kina', 4);
    character.level = 100;
    character.gold = 200_000_000;
    character.forgeDust = 200;
    character.forgeDustLevel = 225;
    character.forgeCores = 10;
    const armor = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character))!;
    const legs = [...itemsById.values()].find((item) => slotFor(item) === 'legs' && canEquip(item, character))!;
    character.equipment.armor = armor.id;
    character.equipment.legs = legs.id;
    character.equipmentTiers = { armor: 2, legs: 0 };
    const price = forgeTierPrice(2)!;
    const result = transferSlotTier(character, 'armor', 'legs', true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receiveTier).toBe(2);
      expect(result.dustCost).toBe(FORGE_CONVERGENCE_TRANSFER_DUST_COST);
      expect(result.cost).toBe(price.convergenceTransfer);
      expect(character.equipmentTiers.armor).toBe(0);
      expect(character.equipmentTiers.legs).toBe(2);
    }
  });

  it('refuses transfer onto a non-zero receiver', () => {
    const character = createCharacter('Kina', 4);
    character.gold = 100_000_000;
    character.forgeDust = 200;
    character.forgeCores = 10;
    const armor = [...itemsById.values()].find((item) => slotFor(item) === 'armor' && canEquip(item, character))!;
    const head = [...itemsById.values()].find((item) => slotFor(item) === 'head' && canEquip(item, character))!;
    character.equipment.armor = armor.id;
    character.equipment.head = head.id;
    character.equipmentTiers = { armor: 3, head: 1 };
    expect(transferSlotTier(character, 'armor', 'head', false).ok).toBe(false);
  });
});
