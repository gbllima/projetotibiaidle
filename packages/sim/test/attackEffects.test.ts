import { describe, expect, it } from 'vitest';
import { attackEffectFor, attackEffectFromWeapon } from '../src/attackEffects.js';
import { itemsById } from '@tibia-idle/data';

describe('attackEffectFromWeapon', () => {
  it('uses meleeAttackEffect tags from Crystal items.xml', () => {
    expect(attackEffectFromWeapon(itemsById.get(50171) ?? null)).toBe('monk-staff');
    expect(attackEffectFromWeapon(itemsById.get(50163) ?? null)).toBe('monk-daggers');
  });

  it('falls back to weaponType for knight weapons', () => {
    expect(attackEffectFromWeapon(itemsById.get(3271) ?? null)).toBe('sword');
    expect(attackEffectFromWeapon(itemsById.get(3279) ?? null)).toBe('club');
    expect(attackEffectFromWeapon(itemsById.get(3266) ?? null)).toBe('axe');
  });

  it('returns fist when unarmed', () => {
    expect(attackEffectFromWeapon(null)).toBe('fist');
    expect(attackEffectFromWeapon(itemsById.get(50181) ?? null)).toBe('fist');
  });
});

describe('attackEffectFor', () => {
  it('maps knight and monk melee vocations', () => {
    expect(attackEffectFor(4, 3271)).toBe('sword');
    expect(attackEffectFor(9, 50171)).toBe('monk-staff');
    expect(attackEffectFor(9, undefined)).toBe('fist');
  });

  it('skips ranged and magic vocations', () => {
    expect(attackEffectFor(3, 2455)).toBeUndefined();
    expect(attackEffectFor(1, 2190)).toBeUndefined();
  });
});
