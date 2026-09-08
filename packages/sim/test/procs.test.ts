import { describe, expect, it } from 'vitest';
import {
  COMBO_CAP, FATAL_DAMAGE, IMBUEMENTS, Rng, advance, combatProcs, comboMultiplier,
  createCharacter, leechAmount, quadraticPoly, referenceCharacter, startSession,
} from '../src/index.js';

describe('forge formulas', () => {
  it('matches Crystal quadraticPoly', () => {
    // tools.hpp:209  a*x^2 + b*x + c
    expect(quadraticPoly(0.05, 0.4, 0.05, 10)).toBeCloseTo(9.05);
    expect(quadraticPoly(0.0307576, 0.440697, 0.026, 10)).toBeCloseTo(7.50873);
    expect(quadraticPoly(0.0127, 0.1070, 0.0073, 10)).toBeCloseTo(2.3473);
  });

  it('scales combo damage up to the cap', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(11)).toBeCloseTo(1.1);
    expect(comboMultiplier(COMBO_CAP + 5)).toBeCloseTo(1 + (COMBO_CAP - 1) * 0.01);
  });

  it('leeches a fraction of real damage', () => {
    // game.cpp:8650  damage * (skill/10000) * (0.1*n + 0.9) / n
    expect(leechAmount(1000, 2500, 1)).toBe(250);
    expect(leechAmount(0, 2500)).toBe(0);
  });
});

describe('imbuement procs', () => {
  it('turns Strike into critical chance, not flat damage', () => {
    const character = createCharacter('Imbued', 4);
    const now = Date.now();
    character.imbuements = [{ slot: 'left', type: 'strike', tier: 3, expiresAt: now + 3_600_000 }];
    const procs = combatProcs(character, now);
    expect(procs.critChance).toBe(500);
    expect(procs.critExtra).toBe(4000);
    const strike = IMBUEMENTS.find((entry) => entry.id === 'strike');
    expect(strike && 'critExtra' in strike).toBe(true);
  });

  it('applies Vampirism as always-on life leech', () => {
    const character = createCharacter('Leech', 4);
    const now = Date.now();
    character.imbuements = [{ slot: 'left', type: 'vampirism', tier: 3, expiresAt: now + 3_600_000 }];
    const procs = combatProcs(character, now);
    expect(procs.lifeLeechChance).toBe(100);
    expect(procs.lifeLeech).toBe(2500);
  });
});

describe('combat procs in a hunt', () => {
  it('builds a combo and can crit when Strike is imbued', () => {
    const character = referenceCharacter(4, 40);
    character.imbuements = [{ slot: 'left', type: 'strike', tier: 3, expiresAt: Date.now() + 3_600_000 }];
    character.policy.autoAttack = true;
    character.policy.healSpellId = '';
    const session = startSession(character, 'elf-cave-ab-dendriel', 42n);
    advance(session, 400, { maxEvents: 0 });
    expect(session.totals.maxCombo).toBeGreaterThan(1);
    expect(session.combo).toBeGreaterThan(0);
  });

  it('does not roll dodge on a fresh character', () => {
    const character = createCharacter('Fresh', 4);
    expect(combatProcs(character).dodgeChance).toBe(0);
    expect(combatProcs(character).onslaughtChance).toBe(0);
    expect(combatProcs(character).momentumChance).toBe(0);
    expect(combatProcs(character).transcendenceChance).toBe(0);
  });

  it('gives high-level gear inferred ruse and onslaught', () => {
    const character = createCharacter('Veteran', 4);
    character.level = 800;
    character.equipment.left = 1;
    character.equipment.armor = 1;
    const procs = combatProcs(character);
    expect(procs.dodgeChance).toBeGreaterThan(1);
    expect(procs.onslaughtChance).toBeGreaterThan(1);
    expect(FATAL_DAMAGE).toBe(0.6);
  });

  it('reads Momentum from head and Transcendence from legs, amplified by boots', () => {
    const character = createCharacter('Forged', 4);
    character.level = 100;
    character.equipment.head = 1;
    character.equipment.legs = 1;
    character.equipment.feet = 1;
    character.equipment.left = 1;
    character.equipmentTiers = { head: 5, legs: 5, feet: 5, left: 0 };
    const procs = combatProcs(character);
    expect(procs.momentumChance).toBeGreaterThan(0);
    expect(procs.transcendenceChance).toBeGreaterThan(0);
    expect(procs.amplificationPercent).toBeGreaterThan(0);
    // Without boots amp, chance is lower.
    character.equipmentTiers.feet = 0;
    const bare = combatProcs(character);
    expect(procs.momentumChance).toBeGreaterThan(bare.momentumChance);
    expect(procs.transcendenceChance).toBeGreaterThan(bare.transcendenceChance);
  });

  it('can trigger forge Transcendence avatar in a hunt', () => {
    const character = referenceCharacter(4, 80);
    character.equipment.legs = character.equipment.legs ?? 1;
    character.equipmentTiers = { ...(character.equipmentTiers ?? {}), legs: 10, feet: 10 };
    character.policy.autoAttack = true;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    let triggered = false;
    for (let seed = 1n; seed <= 40n; seed += 1n) {
      const session = startSession(structuredClone(character), 'venore-rotworm-cave', seed);
      session.startedAt = Date.now();
      const events = advance(session, 2_000, { maxEvents: 500, creatureFlee: false });
      if (events.some((event) => event.type === 'buff' && event.words === 'transcendence')
        || (session.totals.avatars ?? 0) > 0) {
        triggered = true;
        expect(session.avatarTicks === undefined || session.avatarTicks >= 0).toBe(true);
        break;
      }
    }
    expect(triggered).toBe(true);
  });
});

describe('rng bounds used by procs', () => {
  it('uniform is inclusive', () => {
    const rng = new Rng(1n);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(rng.uniform(1, 3));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });
});
