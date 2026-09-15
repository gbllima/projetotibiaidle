import { describe, expect, it } from 'vitest';
import {
  advance,
  createCharacter,
  startSession,
  TICK_MS,
  WAVE_CYCLE_KILLS,
  WAVE_PACK,
  waveActiveLimit,
  waveProgress,
} from '../src/index.js';

const NORMAL_WAVE_DELAY_TICKS = Math.round(3_000 / TICK_MS);
const BOSS_WAVE_DELAY_TICKS = Math.round(5_000 / TICK_MS);

function passiveTank(name: string) {
  const character = createCharacter(name, 4);
  character.level = 100;
  character.health = 1_000_000_000;
  character.mana = 0;
  character.policy.autoAttack = false;
  character.policy.fleeAt = 0;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  return character;
}

describe('wave reinforcements', () => {
  it('opens Amazon Camp wave 2 after exactly 3 seconds even with zero spawn credits', () => {
    const session = startSession(passiveTank('AmazonTimer'), 'amazon-camp', 77n);
    session.totals.kills = WAVE_PACK[0]!;
    session.active = [];
    session.spawnCredits = 0;

    const early = advance(session, NORMAL_WAVE_DELAY_TICKS - 1, { maxEvents: 80 });
    expect(waveProgress(session.totals.kills).waveIndex).toBe(1);
    expect(session.active).toHaveLength(0);
    expect(early.some((event) => event.type === 'monster_spawn')).toBe(false);

    const onTime = advance(session, 1, { maxEvents: 80 });
    expect(session.active).toHaveLength(waveActiveLimit(1));
    expect(onTime.filter((event) => event.type === 'monster_spawn')).toHaveLength(waveActiveLimit(1));
  });

  it('never leaves the last Amazon Camp wave 2 reinforcement waiting for reward credits', () => {
    const session = startSession(passiveTank('AmazonMidWave'), 'amazon-camp', 79n);
    // Wave 2 contains five enemies. Pretend four have already died and the
    // visible floor is empty while the fifth still belongs to this wave.
    session.totals.kills = WAVE_PACK[0]! + WAVE_PACK[1]! - 1;
    session.active = [];
    session.spawnCredits = 0;
    Object.assign(session, {
      reinforcementWaveIndex: 1,
      reinforcementReadyTick: undefined,
      nextWaveAtTick: undefined,
    });

    const events = advance(session, 1, { maxEvents: 80 });
    expect(waveProgress(session.totals.kills)).toEqual({ waveIndex: 1, killed: 4, size: 5 });
    expect(session.active).toHaveLength(1);
    expect(events.filter((event) => event.type === 'monster_spawn')).toHaveLength(1);
  });

  it('opens the skull wave after exactly 5 seconds even with zero spawn credits', () => {
    const session = startSession(passiveTank('BossTimer'), 'amazon-camp', 78n);
    session.totals.kills = WAVE_CYCLE_KILLS - WAVE_PACK[9]!;
    session.active = [];
    session.spawnCredits = 0;

    advance(session, BOSS_WAVE_DELAY_TICKS - 1, { maxEvents: 80 });
    expect(waveProgress(session.totals.kills).waveIndex).toBe(9);
    expect(session.active).toHaveLength(0);

    const onTime = advance(session, 1, { maxEvents: 80 });
    expect(session.active).toHaveLength(1);
    expect(onTime.filter((event) => event.type === 'monster_spawn')).toHaveLength(1);
  });

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
      // The visible release cadence is independent from reward credits. Make the
      // test about screen caps and wave progress, not equipment DPS.
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
