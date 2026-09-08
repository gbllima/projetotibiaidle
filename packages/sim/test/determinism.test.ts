import { describe, expect, it } from 'vitest';
import { hunts } from '@tibia-idle/data';
import {
  advance, defaultSupplies, referenceCharacter, Rng, startSession,
  TICKS_PER_HOUR, type HuntSession, type SimEvent,
} from '../src/index.js';

/**
 * Determinism is the load-bearing assumption of the architecture: the browser
 * animates a session that the server settles independently, and the two must
 * agree exactly (docs/02-ARQUITETURA.md section 1). These tests fail loudly if
 * anything reaches for `Math.random` or if simulating in different chunk sizes
 * diverges.
 */

const HUNT = hunts.find((h) => h.id === 'elf-cave-ab-dendriel') ?? hunts[0]!;

function run(seed: bigint, ticks: number, chunk = ticks): { session: HuntSession; events: SimEvent[] } {
  const character = referenceCharacter(4, 40);
  character.supplies = defaultSupplies(character, 4);
  const session = startSession(character, HUNT.id, seed);

  const events: SimEvent[] = [];
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(chunk, remaining);
    events.push(...advance(session, step, { maxEvents: 1_000_000 }));
    remaining -= step;
  }
  return { session, events };
}

describe('Rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = new Rng(12345n);
    const b = new Rng(12345n);
    const left = Array.from({ length: 500 }, () => a.nextUint32());
    const right = Array.from({ length: 500 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });

  it('produces different streams for adjacent seeds', () => {
    const a = new Rng(1n);
    const b = new Rng(2n);
    const left = Array.from({ length: 100 }, () => a.nextUint32());
    const right = Array.from({ length: 100 }, () => b.nextUint32());
    expect(left).not.toEqual(right);
  });

  it('restores an exact stream from saved state', () => {
    const rng = new Rng(999n);
    for (let i = 0; i < 50; i += 1) rng.nextUint32();
    const state = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.nextUint32());

    const restored = new Rng(0n);
    restored.setState(state);
    expect(Array.from({ length: 20 }, () => restored.nextUint32())).toEqual(expected);
  });

  it('keeps uniform draws inside the requested range', () => {
    const rng = new Rng(7n);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.uniform(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('centres normal draws on the middle of the range', () => {
    const rng = new Rng(11n);
    let total = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) total += rng.normal(0, 100);
    expect(total / samples).toBeGreaterThan(48);
    expect(total / samples).toBeLessThan(52);
  });
});

describe('hunt session', () => {
  it('opens with the pack already on the floor', () => {
    const character = referenceCharacter(4, 40);
    character.supplies = defaultSupplies(character, 4);
    const session = startSession(character, HUNT.id, 1n);
    expect(session.active.length).toBeGreaterThan(0);
  });

  it('produces identical results from the same seed', () => {
    const a = run(555n, 2000);
    const b = run(555n, 2000);
    expect(a.session.totals).toEqual(b.session.totals);
    expect(a.events).toEqual(b.events);
  });

  it('diverges for different seeds', () => {
    const a = run(1n, 2000);
    const b = run(2n, 2000);
    expect(a.session.totals).not.toEqual(b.session.totals);
  });

  it('is unaffected by how the ticks are chunked', () => {
    // The server settles a whole session at once; the browser advances it a
    // frame at a time. Both paths have to land on the same state.
    const whole = run(31337n, 1200, 1200);
    const chunked = run(31337n, 1200, 37);
    expect(chunked.session.totals).toEqual(whole.session.totals);
    expect(chunked.session.character.experience).toBe(whole.session.character.experience);
    expect(chunked.events).toEqual(whole.events);
  });

  it('advances the rng state so repeated calls continue rather than repeat', () => {
    const character = referenceCharacter(4, 40);
    character.supplies = defaultSupplies(character, 8);
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.manaPotionAt = 0;
    character.mana = 9999;
    const session = startSession(character, HUNT.id, 77n);

    advance(session, 400, { maxEvents: 0 });
    const afterFirst = session.totals.kills;
    advance(session, 800, { maxEvents: 0 });
    expect(session.totals.kills).toBeGreaterThan(afterFirst);
  });

  it('records every kill in the bestiary', () => {
    const { session } = run(99n, TICKS_PER_HOUR / 4);
    const recorded = Object.values(session.character.bestiary).reduce((sum, n) => sum + n, 0);
    expect(recorded).toBe(session.totals.kills);
    expect(session.totals.kills).toBeGreaterThan(0);
  });

  it('settles a full hour in well under a second', () => {
    const started = performance.now();
    run(4242n, TICKS_PER_HOUR, TICKS_PER_HOUR);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
