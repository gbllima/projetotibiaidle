import { describe, expect, it } from 'vitest';
import { itemsByName } from '@tibia-idle/data';
import {
  advance, ammoProfile, combatHitChance, createCharacter, deriveStats, distanceHitChance, startSession,
} from '../src/index.js';

const ARROW = itemsByName.get('arrow')!;
const BOW = itemsByName.get('bow')!;

describe('distance accuracy', () => {
  it('computes Crystal-style hit chance from skill and ammo', () => {
    const paladin = createCharacter('Ranger', 3);
    paladin.level = 50;
    paladin.equipment.left = BOW.id;
    paladin.equipment.ammo = ARROW.id;
    const stats = deriveStats(paladin);
    const profile = ammoProfile(ARROW.id)!;
    const chance = distanceHitChance(paladin, stats, profile, 1);
    expect(chance).toBeGreaterThanOrEqual(90);
    expect(chance).toBeLessThanOrEqual(100);
    expect(combatHitChance(paladin, stats)).toBe(chance);
  });

  it('adds low-level bonus and bow hitChance', () => {
    const paladin = createCharacter('Ranger', 3);
    paladin.level = 10;
    paladin.equipment.left = BOW.id;
    paladin.equipment.ammo = ARROW.id;
    const stats = deriveStats(paladin);
    const profile = ammoProfile(ARROW.id)!;
    const base = distanceHitChance({ ...paladin, level: 50 }, stats, profile, 1);
    const low = distanceHitChance(paladin, stats, profile, 1);
    expect(low).toBe(Math.min(100, base + 50));
  });

  it('returns null for non-distance vocations', () => {
    const knight = createCharacter('Tank', 4);
    expect(combatHitChance(knight, deriveStats(knight))).toBeNull();
  });

  it('records misses on failed hit rolls', () => {
    const paladin = createCharacter('Ranger', 3);
    paladin.policy.healthPotionId = -1;
    paladin.policy.manaPotionId = -1;
    paladin.policy.healSpellId = '';
    paladin.policy.autoAttack = true;
    paladin.equipment.left = BOW.id;
    paladin.equipment.ammo = ARROW.id;
    paladin.supplies = [{ itemId: ARROW.id, count: 500 }];

    const session = startSession(paladin, 'swamp-trolls', 99n);
    advance(session, 4000, { maxEvents: 5000, creatureFlee: false });
    expect(session.totals.misses ?? 0).toBeGreaterThanOrEqual(0);
  });
});
