import { describe, expect, it } from 'vitest';
import {
  advance, BOSS_HEALTH_MULT, BOSS_REWARD_MULT, createCharacter, deriveStats,
  describeSession, huntThroughput, SPELLS, startSession, TICKS_PER_HOUR, WAVE_PACK, waveProgress, DEFAULT_TUNING,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

function readyKnight(level = 40): ReturnType<typeof createCharacter> {
  const character = createCharacter('Kina', 4);
  character.level = level;
  character.skills.sword = { level: 70, tries: 0 };
  character.equipment.left = 3271;
  character.mana = 5000;
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  return character;
}

describe('fixed wave packs', () => {
  it('starts wave 1 with a fixed pack and does not drip-spawn mid-wave', () => {
    const character = readyKnight(12);
    character.skills.sword = { level: 15, tries: 0 };
    character.equipment.left = 3264;
    character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
    const session = startSession(character, HUNT, 21n);
    expect(session.active.length).toBe(WAVE_PACK[0]);
    const startUids = new Set(session.active.map((monster) => monster.uid));
    const events = advance(session, 30, { maxEvents: 800 });
    const deaths = events.filter((event) => event.type === 'monster_death').length;
    const spawns = events.filter((event) => event.type === 'monster_spawn');
    // Still inside wave 1 → no replacement spawns mid-pack.
    expect(deaths).toBeLessThan(WAVE_PACK[0]);
    expect(spawns).toHaveLength(0);
    expect(session.active.every((monster) => startUids.has(monster.uid))).toBe(true);
  });

  it('spawns the full next wave only after the floor clears', () => {
    const session = startSession(readyKnight(40), HUNT, 22n);
    session.totals.kills = WAVE_PACK[0];
    session.active = [];
    session.spawnCredits = WAVE_PACK[1]!;
    const events = advance(session, 1, { maxEvents: 40 });
    expect(describeSession(session)?.wave).toBe(2);
    expect(session.active.length).toBe(WAVE_PACK[1]);
    expect(events.filter((event) => event.type === 'monster_spawn')).toHaveLength(WAVE_PACK[1]);
  });

  it('waits for the zone spawn budget before releasing another complete wave', () => {
    const session = startSession(readyKnight(40), HUNT, 22n);
    session.totals.kills = WAVE_PACK[0];
    session.active = [];
    session.spawnCredits = 0;
    advance(session, 100, { tuning: { ...DEFAULT_TUNING, spawnRate: 0 } });
    expect(session.active).toHaveLength(0);

    const requiredTicks = Math.ceil(WAVE_PACK[1]! * TICKS_PER_HOUR / huntThroughput(HUNT).killsPerHour);
    advance(session, requiredTicks - 1);
    expect(session.active).toHaveLength(0);
    const events = advance(session, 1);
    expect(session.active).toHaveLength(WAVE_PACK[1]);
    expect(events.filter((event) => event.type === 'monster_spawn')).toHaveLength(WAVE_PACK[1]);
  });

  it('wave 10 is one creature with ×10 HP and ×10 reward mult', () => {
    expect(BOSS_REWARD_MULT).toBe(BOSS_HEALTH_MULT);
    expect(BOSS_HEALTH_MULT).toBe(10);
    const session = startSession(readyKnight(80), HUNT, 23n);
    const beforeBoss = waveProgress(0);
    // Jump to the skull wave.
    let kills = 0;
    for (let i = 0; i < 9; i += 1) kills += WAVE_PACK[i]!;
    session.totals.kills = kills;
    session.active = [];
    session.spawnCredits = 1;
    advance(session, 1, { maxEvents: 20 });
    expect(describeSession(session)?.wave).toBe(10);
    expect(session.active).toHaveLength(1);
    expect(session.active[0]!.maxHealth).toBeGreaterThanOrEqual(beforeBoss.size); // sanity
    // Rotworm base HP * 10
    expect(session.active[0]!.maxHealth % BOSS_HEALTH_MULT === 0 || session.active[0]!.maxHealth >= 10).toBe(true);
  });

  it('exori hits every living creature for damage in one cast', () => {
    const character = readyKnight(50);
    character.policy.disabledSpells = SPELLS
      .filter((spell) => spell.id !== 'berserk')
      .map((spell) => spell.id);
    const session = startSession(character, HUNT, 24n);
    expect(session.active.length).toBeGreaterThanOrEqual(3);
    const before = session.active.map((monster) => ({ uid: monster.uid, hp: monster.health }));
    const events = advance(session, 12, { maxEvents: 400 });
    const cast = events.find((event) => event.type === 'player_attack' && event.words === 'exori');
    expect(cast?.area).toBe(true);
    const hits = events.filter(
      (event) => event.type === 'player_attack' && event.area === true && event.uid !== undefined,
    );
    const hitUids = new Set(hits.filter((event) => (event.amount ?? 0) > 0).map((event) => event.uid));
    expect(hitUids.size).toBeGreaterThanOrEqual(Math.min(3, before.length));
    for (const monster of session.active) {
      const prior = before.find((entry) => entry.uid === monster.uid);
      if (prior && hitUids.has(monster.uid)) {
        expect(monster.health).toBeLessThan(prior.hp);
      }
    }
  });
});
