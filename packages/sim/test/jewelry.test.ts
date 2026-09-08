import { describe, expect, it } from 'vitest';
import {
  absorbPercent, applyDeathPenalty, bestiaryStage, createCharacter, defaultSupplies, jewelryMagicShield,
  jewelryRegen, jewelrySkillBonus, LIFE_RING, packHuntSupplies, RING_OF_HEALING, skillLevel, slotFor,
  STONE_SKIN_AMULET, takeItemStack, tickJewelry, TIME_RING, AMULET_OF_LOSS, ENERGY_RING, wearItem,
  startSession, advance, suppliesCost,
} from '../src/index.js';
import { itemsById as catalog } from '@tibia-idle/data';

function idleKnight() {
  const character = createCharacter('Kina', 4);
  character.level = 30;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.haste = false;
  character.policy.food = false;
  return character;
}

describe('jewellery', () => {
  it('equips ring of healing and amulet of loss despite empty item.type', () => {
    expect(slotFor(catalog.get(RING_OF_HEALING)!)).toBe('ring');
    expect(slotFor(catalog.get(AMULET_OF_LOSS)!)).toBe('necklace');
    const character = idleKnight();
    expect(wearItem(character, RING_OF_HEALING).ok).toBe(true);
    expect(wearItem(character, AMULET_OF_LOSS).ok).toBe(true);
    expect(character.equipment.ring).toBe(RING_OF_HEALING);
    expect(character.equipment.necklace).toBe(AMULET_OF_LOSS);
  });

  it('life ring adds Crystal HP/mana regen while the duration holds', () => {
    const character = idleKnight();
    expect(wearItem(character, LIFE_RING).ok).toBe(true);
    const regen = jewelryRegen(character);
    expect(regen.health).toBeCloseTo(8 / 24, 5);
    expect(regen.mana).toBeCloseTo(1 / 24, 5);
    expect(character.equipmentDuration.ring).toBeGreaterThan(0);
  });

  it('sword ring grants +4 sword fighting', () => {
    const character = idleKnight();
    const before = skillLevel(character, 'sword');
    expect(wearItem(character, 3091).ok).toBe(true);
    expect(jewelrySkillBonus(character, 'sword')).toBe(4);
    expect(skillLevel(character, 'sword')).toBe(before + 4);
  });

  it('stone skin amulet absorbs 80% physical and spends charges on hits', () => {
    const character = idleKnight();
    expect(wearItem(character, STONE_SKIN_AMULET).ok).toBe(true);
    expect(character.equipmentCharges.necklace).toBe(5);
    expect(absorbPercent(character, 'COMBAT_PHYSICALDAMAGE')).toBe(80);
    expect(absorbPercent(character, 'COMBAT_FIREDAMAGE')).toBe(0);

    const session = startSession(character, 'venore-rotworm-cave', 13n);
    session.character.health = 800;
    advance(session, 80, { maxEvents: 200, tuning: { rangedExposure: 1, spawnRate: 1 } });
    const charges = session.character.equipmentCharges.necklace ?? 0;
    const gone = session.character.equipment.necklace !== STONE_SKIN_AMULET;
    expect(charges < 5 || gone).toBe(true);
  });

  it('energy ring is a mana shield and time ring kites', () => {
    const character = idleKnight();
    expect(wearItem(character, ENERGY_RING).ok).toBe(true);
    expect(jewelryMagicShield(character)).toBe(true);
    expect(wearItem(character, TIME_RING).ok).toBe(true);
    expect(character.equipment.ring).toBe(TIME_RING);
  });

  it('duration rings decay and can be replaced from the warehouse', () => {
    const character = idleKnight();
    expect(wearItem(character, LIFE_RING).ok).toBe(true);
    character.warehouse = [{ itemId: LIFE_RING, count: 1 }];
    character.equipmentDuration.ring = 1;
    const session = startSession(character, 'venore-rotworm-cave', 5n);
    tickJewelry(session, () => undefined);
    expect(session.character.equipment.ring).toBe(LIFE_RING);
    expect(session.character.warehouse.length).toBe(0);
    expect(session.character.equipmentDuration.ring).toBeGreaterThan(1);
  });
});

describe('death pouch and amulet of loss', () => {
  it('drops pouch gold without blessings and keeps it with an amulet of loss', () => {
    const naked = idleKnight();
    const session = startSession(naked, 'venore-rotworm-cave', 7n);
    session.totals.lootByItem[3031] = 100;
    const gold = catalog.get(3031);
    const unit = gold?.sellPrice ?? 1;
    session.totals.lootValue = 100 * unit;
    const dropped = applyDeathPenalty(naked, session);
    expect(dropped.aolUsed).toBe(false);
    expect(dropped.pouchLost).toBeGreaterThan(0);
    expect(session.totals.lootByItem[3031]).toBe(80);

    const protectedChar = idleKnight();
    expect(wearItem(protectedChar, AMULET_OF_LOSS).ok).toBe(true);
    const saved = startSession(protectedChar, 'venore-rotworm-cave', 9n);
    saved.totals.lootByItem[3031] = 100;
    saved.totals.lootValue = 100 * unit;
    const result = applyDeathPenalty(protectedChar, saved);
    expect(result.aolUsed).toBe(true);
    expect(result.pouchLost).toBe(0);
    expect(saved.totals.lootByItem[3031]).toBe(100);
    expect(protectedChar.equipment.necklace).toBeUndefined();
  });
});

describe('warehouse restock', () => {
  it('pulls potions from the depot before spending gold', () => {
    const character = idleKnight();
    character.gold = 10_000;
    const hourly = defaultSupplies(character, 1);
    const potion = hourly.find((stack) => stack.itemId === 266);
    expect(potion).toBeDefined();
    character.warehouse = [{ itemId: 266, count: potion!.count }];
    const goldBefore = character.gold;
    const packed = packHuntSupplies(character, 1);
    const fullCost = suppliesCost(defaultSupplies(idleKnight(), 1));
    expect(packed.supplies.some((stack) => stack.itemId === 266 && stack.count === potion!.count)).toBe(true);
    expect(packed.cost).toBe(fullCost - suppliesCost([{ itemId: 266, count: potion!.count }]));
    expect(packed.cost).toBeLessThan(goldBefore);
    expect(character.warehouse.find((stack) => stack.itemId === 266)).toBeUndefined();
    expect(takeItemStack([{ itemId: 1, count: 3 }], 1, 2)).toBe(2);
  });
});

describe('bestiary stages', () => {
  it('follows CipSoft first / second / mastered gates', () => {
    expect(bestiaryStage(0, 10, 100, 500)).toBe('unknown');
    expect(bestiaryStage(1, 10, 100, 500)).toBe('observed');
    expect(bestiaryStage(10, 10, 100, 500)).toBe('proficient');
    expect(bestiaryStage(100, 10, 100, 500)).toBe('adept');
    expect(bestiaryStage(500, 10, 100, 500)).toBe('mastered');
  });
});
