import { describe, expect, it } from 'vitest';
import {
  addForgeDust, convertDustToSlivers, convertSliversToCore, createCharacter, dustFromStack,
  FORGE_CONVERGENCE_FUSION_DUST_COST, FORGE_CONVERGENCE_TRANSFER_DUST_COST, FORGE_DUST_LEVEL_DEFAULT,
  FORGE_FUSION_DUST_COST, FORGE_SLIVERS_PER_CORE, FORGE_TRANSFER_DUST_COST, forgeFusionSuccessChance,
  forgeTierPrice, raiseForgeDustCap, Rng, rollForgeDustOnKill,
} from '../src/index.js';

describe('exaltation forge dust', () => {
  it('uses Crystal flat fusion dust cost and success rates', () => {
    expect(FORGE_FUSION_DUST_COST).toBe(100);
    expect(FORGE_TRANSFER_DUST_COST).toBe(100);
    expect(FORGE_CONVERGENCE_FUSION_DUST_COST).toBe(130);
    expect(FORGE_CONVERGENCE_TRANSFER_DUST_COST).toBe(160);
    expect(FORGE_DUST_LEVEL_DEFAULT).toBe(100);
    expect(forgeFusionSuccessChance(false)).toBe(50);
    expect(forgeFusionSuccessChance(true)).toBe(65);
    expect(forgeTierPrice(1)?.convergenceFusion).toBe(55_000_000);
    expect(forgeTierPrice(2)?.cores).toBe(2);
  });

  it('rolls dust from forge stacks like Crystal', () => {
    const rng = new Rng(7n);
    for (let i = 0; i < 20; i += 1) {
      const amount = dustFromStack(5, rng);
      expect(amount).toBeGreaterThanOrEqual(5);
      expect(amount).toBeLessThanOrEqual(15);
    }
  });

  it('caps dust at forgeDustLevel', () => {
    const character = createCharacter('Kina', 4);
    character.forgeDustLevel = 100;
    expect(addForgeDust(character, 150)).toBe(100);
    expect(character.forgeDust).toBe(100);
    expect(addForgeDust(character, 10)).toBe(0);
  });

  it('can raise the dust cap with gold', () => {
    const character = createCharacter('Kina', 4);
    character.gold = 100_000;
    character.forgeDustLevel = 100;
    const result = raiseForgeDustCap(character);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.level).toBe(101);
      expect(character.forgeDustLevel).toBe(101);
    }
  });

  it('sometimes grants dust on kill under forced RNG', () => {
    const character = createCharacter('Kina', 4);
    character.forgeDustLevel = 225;
    let hit = false;
    for (let seed = 1n; seed <= 800n; seed += 1n) {
      const drop = rollForgeDustOnKill(character, new Rng(seed), false, 'rotworm');
      if (drop) {
        hit = true;
        expect(drop.dust + drop.slivers).toBeGreaterThan(0);
        break;
      }
    }
    expect(hit).toBe(true);
  });

  it('converts dust to slivers and slivers to cores', () => {
    const character = createCharacter('Kina', 4);
    character.forgeDust = 100;
    character.forgeDustLevel = 225;
    const toSlivers = convertDustToSlivers(character, 2);
    expect(toSlivers.ok).toBe(true);
    if (toSlivers.ok) {
      expect(toSlivers.sliversGained).toBe(6);
      expect(character.forgeDust).toBe(60);
      expect(character.forgeSlivers).toBe(6);
    }
    character.forgeSlivers = FORGE_SLIVERS_PER_CORE;
    const toCore = convertSliversToCore(character, 1);
    expect(toCore.ok).toBe(true);
    if (toCore.ok) {
      expect(character.forgeCores).toBe(1);
      expect(character.forgeSlivers).toBe(0);
    }
  });
});
