import { describe, expect, it } from 'vitest';
import {
  advance,
  createCharacter,
  startSession,
  waveActiveLimit,
  waveProgress,
} from '../src/index.js';

describe('wave reinforcements', () => {
  it('keeps the active floor capped while preserving later reinforcements', () => {
    const character = createCharacter('CapTester', 4);
    character.level = 200;
    character.health = 1_000_000_000;
    character.mana = 1_000_000;
    character.policy.fleeAt = 0;
    character.policy.healthPotionAt = 0;
    character.policy.manaPotionAt = 0;
    character.policy.stopWhenOutOfSupplies = false;

    const session = startSession(character, 'venore-rotworm-cave', 991n);
    let furthestWave = 0;

    for (let tick = 0; tick < 4_000 && session.status === 'active'; tick += 1) {
      // This test isolates release cadence and screen caps. Calibration tests
      // separately verify that real hunts earn these credits at the correct rate.
      session.spawnCredits = Math.max(session.spawnCredits, waveProgress(session.totals.kills).size);
      // Make the test about release cadence, not equipment DPS.
      for (const monster of session.active) monster.health = Math.min(monster.health, 1);
      advance(session, 1, { maxEvents: 0 });
      const progress = waveProgress(session.totals.kills);
      furthestWave = Math.max(furthestWave, progress.waveIndex);
      expect(session.active.length).toBeLessThanOrEqual(waveActiveLimit(progress.waveIndex));
      if (furthestWave >= 8) break;
    }

    expect(furthestWave).toBeGreaterThanOrEqual(8);
  });

  it('shares the screen cap across four party sessions', () => {
    const sessions = Array.from({ length: 4 }, (_, index) => {
      const character = createCharacter(`Party${index}`, 4);
      character.level = 100;
      character.health = 1_000_000;
      character.policy.fleeAt = 0;
      character.policy.healthPotionAt = 0;
      character.policy.stopWhenOutOfSupplies = false;
      const session = startSession(character, 'venore-rotworm-cave', BigInt(100 + index));
      Object.assign(session, {
        reinforcementPartySize: 4,
        reinforcementPartyIndex: index,
      });
      advance(session, 1, { maxEvents: 0 });
      return session;
    });

    // Wave 1 normally has three monsters per session. A four-player party now
    // receives one visible monster per member instead of twelve on one screen.
    expect(sessions.reduce((sum, session) => sum + session.active.length, 0)).toBe(4);
    expect(sessions.every((session) => session.active.length === 1)).toBe(true);
  });
});
