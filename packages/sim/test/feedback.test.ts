import { describe, expect, it } from 'vitest';
import {
  advance, createCharacter, defaultSupplies, deriveStats, describeSession, formatCombatLog, huntThroughput,
  magicProgressPercent, skillProgressPercent, startSession,
  BOSS_HEALTH_MULT, WAVE_CYCLE_KILLS, WAVE_PACK, wavePackSize,
} from '../src/index.js';

const HUNT = 'elf-cave-ab-dendriel';

describe('combat feedback events', () => {
  it('emits healing spell words when the knight is hurt', () => {
    const character = createCharacter('Bowen', 4);
    character.level = 20;
    character.mana = 200;
    character.policy.healthPotionAt = 0;
    character.policy.healSpellAt = 0.9;
    character.policy.healSpellId = 'wound_cleansing';
    const session = startSession(character, HUNT, 7n);
    session.character.health = Math.floor(deriveStats(session.character).maxHealth * 0.4);
    const events = advance(session, 8, { maxEvents: 200 });
    const heal = events.find((event) => event.type === 'heal');
    expect(heal?.words).toBe('exura infir ico');
    expect((heal?.amount ?? 0)).toBeGreaterThan(0);
  });

  it('emits attack spell words for a sorcerer', () => {
    const character = createCharacter('Mage', 1);
    character.level = 40;
    character.mana = 9999;
    character.policy.autoAttack = false;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 11n);
    const events = advance(session, 40, { maxEvents: 400 });
    expect(events.some((event) => event.type === 'player_attack' && Boolean(event.words))).toBe(true);
    // Area waves use CONST_ME_*; single-target strikes may still shoot.
    expect(events.some((event) => (
      event.type === 'player_attack'
      && (Boolean(event.shoot) || event.area === true)
    ))).toBe(true);
  });

  it('emits a wand missile and elemental damage for a sorcerer auto-attack', () => {
    const character = createCharacter('Mage', 1);
    character.equipment.left = 3074;
    character.mana = 9999;
    character.policy.autoAttack = true;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 13n);
    const events = advance(session, 24, { maxEvents: 400 });
    const bolt = events.find((event) => (
      event.type === 'player_attack'
      && Boolean(event.uid)
      && event.shoot === 'CONST_ANI_ENERGY'
      && (event.amount ?? 0) > 0
    ));
    expect(bolt).toBeTruthy();
    expect(bolt?.damageType).toBe('COMBAT_ENERGYDAMAGE');
    expect((bolt?.amount ?? 0)).toBeGreaterThan(0);
  });

  it('emits a rod missile for a druid auto-attack', () => {
    const character = createCharacter('Druid', 2);
    character.equipment.left = 3066;
    character.mana = 9999;
    character.policy.autoAttack = true;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 17n);
    const events = advance(session, 24, { maxEvents: 400 });
    const bolt = events.find((event) => (
      event.type === 'player_attack' && Boolean(event.uid) && event.shoot === 'CONST_ANI_SMALLEARTH'
    ));
    expect(bolt).toBeTruthy();
    expect(bolt?.damageType).toBe('COMBAT_EARTHDAMAGE');
  });

  it('emits monster-attack damage the player can show', () => {
    const character = createCharacter('Kina', 4);
    character.level = 8;
    character.health = 80;
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    const session = startSession(character, HUNT, 7n);
    const events = advance(session, 40, { maxEvents: 400 });
    const hit = events.find((event) => event.type === 'monster_attack' && (event.amount ?? 0) > 0);
    expect(hit).toBeTruthy();
  });

  it('emits weapon attackEffect on knight melee auto-attacks', () => {
    const character = createCharacter('Kina', 4);
    character.level = 20;
    character.health = 500;
    character.equipment.left = 3271; // spike sword
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    const session = startSession(character, HUNT, 19n);
    const events = advance(session, 24, { maxEvents: 400 });
    const swing = events.find((event) => (
      event.type === 'player_attack'
      && event.attackEffect === 'sword'
      && Boolean(event.uid)
      && (event.amount ?? 0) > 0
      && !event.words
    ));
    expect(swing).toBeTruthy();
  });

  it('emits a melee missile when the knight auto-attacks', () => {
    const character = createCharacter('Kina', 4);
    character.level = 20;
    character.health = 500;
    character.mana = 200;
    character.policy.healthPotionAt = 0;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    const session = startSession(character, HUNT, 5n);
    const events = advance(session, 24, { maxEvents: 400 });
    const swing = events.find((event) => event.type === 'player_attack' && Boolean(event.shoot) && Boolean(event.uid));
    expect(swing?.shoot).toMatch(/WHIRLWIND/);
  });
});

describe('wave 10', () => {
  it('opens a hunt on wave 1 with three monsters', () => {
    const character = createCharacter('Bowen', 4);
    const session = startSession(character, HUNT, 3n);
    expect(describeSession(session)?.wave).toBe(1);
    expect(describeSession(session)?.bossWave).toBe(false);
    expect(session.active.length).toBe(WAVE_PACK[0]);
  });

  it('grows the pack each wave and caps at 14 before the skull', () => {
    expect([...WAVE_PACK]).toEqual([3, 5, 7, 9, 11, 13, 14, 14, 14, 1]);
    expect(wavePackSize(0)).toBe(3);
    expect(wavePackSize(1)).toBe(5);
    expect(Math.max(...WAVE_PACK.slice(0, 9))).toBe(14);
    expect(wavePackSize(9)).toBe(1);
  });

  it('flags the skull wave after the nine growing packs', () => {
    const character = createCharacter('Bowen', 4);
    const session = startSession(character, HUNT, 3n);
    expect(describeSession(session)?.bossWave).toBe(false);
    session.totals.kills = WAVE_CYCLE_KILLS - WAVE_PACK[9]!;
    const view = describeSession(session);
    expect(view?.wave).toBe(10);
    expect(view?.bossWave).toBe(true);
    expect(view?.packSize).toBe(1);
  });

  it('fills wave 2 as soon as wave 1 is dead', () => {
    const character = createCharacter('Bowen', 4);
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 3n);
    expect(session.active.length).toBe(WAVE_PACK[0]);
    session.totals.kills = WAVE_PACK[0];
    session.active = [];
    session.spawnCredits = WAVE_PACK[1]!;
    const events = advance(session, 1, { maxEvents: 40 });
    expect(describeSession(session)?.wave).toBe(2);
    expect(session.active.length).toBe(WAVE_PACK[1]);
    expect(events.filter((event) => event.type === 'monster_spawn')).toHaveLength(WAVE_PACK[1]);
  });

  it('fills wave 3 as soon as wave 2 is dead', () => {
    const character = createCharacter('Bowen', 4);
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 3n);
    session.totals.kills = WAVE_PACK[0] + WAVE_PACK[1];
    session.active = [];
    session.spawnCredits = WAVE_PACK[2]!;
    advance(session, 1, { maxEvents: 40 });
    expect(describeSession(session)?.wave).toBe(3);
    expect(session.active.length).toBe(WAVE_PACK[2]);
  });

  it('opens the next wave once spawn credits cover the pack', () => {
    const character = createCharacter('Bowen', 4);
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.fleeAt = 0;
    const session = startSession(character, HUNT, 3n);
    session.totals.kills = WAVE_PACK[0];
    session.active = [];
    session.spawnCredits = WAVE_PACK[1]!;
    const events = advance(session, 1, { maxEvents: 40 });
    expect(describeSession(session)?.wave).toBe(2);
    expect(session.active.length).toBe(WAVE_PACK[1]);
    expect(events.filter((event) => event.type === 'monster_spawn')).toHaveLength(WAVE_PACK[1]);
    expect(session.spawnCredits).toBeGreaterThanOrEqual(0);
  });

  it('fills wave 10 with one boosted copy of the cave creature', () => {
    const character = createCharacter('Bowen', 4);
    character.level = 80;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.fleeAt = 0;
    character.supplies = defaultSupplies(character, 8);
    const session = startSession(character, HUNT, 9n);
    const throughput = huntThroughput(HUNT);
    const toughest = throughput.monsters
      .filter((monster) => !monster.isBoss)
      .reduce((best, monster) => (monster.health > best.health ? monster : best), throughput.monsters[0]!);
    session.totals.kills = WAVE_CYCLE_KILLS - 1;
    session.active = [];
    session.spawnCredits = 4;
    advance(session, 1, { maxEvents: 20 });
    expect(session.active.length).toBe(1);
    expect(session.active[0]?.monsterId).toBe(toughest.id);
    expect(session.active[0]?.maxHealth).toBe(toughest.health * BOSS_HEALTH_MULT);
  });
});

describe('skill bars', () => {
  it('reports percent of tries toward the next skill and magic level', () => {
    const character = createCharacter('Bowen', 4);
    expect(skillProgressPercent(4, 'sword', 10, 0)).toBe(0);
    const half = skillProgressPercent(4, 'sword', 10, 25);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThanOrEqual(100);
    character.manaSpent = 800;
    expect(magicProgressPercent(4, 0, character.manaSpent)).toBeGreaterThan(0);
  });
});

describe('combat log', () => {
  it('formats a Tibia-style hit and a spoken spell', () => {
    const lines = formatCombatLog([
      { tick: 1, type: 'player_attack', words: 'exori ico' },
      {
        tick: 1, type: 'player_attack', uid: 1, monsterId: 'rat',
        amount: 42, damageType: 'COMBAT_PHYSICALDAMAGE',
      },
      { tick: 2, type: 'heal', amount: 18, words: 'exura infir ico' },
    ]);
    expect(lines.map((line) => line.text)).toEqual([
      'You say: exori ico',
      'A Rat loses 42 hitpoints due to your attack.',
      'You say: exura infir ico',
      'You healed yourself for 18 hitpoints.',
    ]);
    expect(lines[0]?.kind).toBe('say');
    expect(lines[1]?.kind).toBe('hit');
  });

  it('formats the same lines in Portuguese', () => {
    const lines = formatCombatLog([
      { tick: 1, type: 'player_attack', words: 'exori ico' },
      {
        tick: 1, type: 'player_attack', uid: 1, monsterId: 'rat',
        amount: 42, damageType: 'COMBAT_PHYSICALDAMAGE',
      },
    ], 'pt');
    expect(lines.map((line) => line.text)).toEqual([
      'Você diz: exori ico',
      'Um Rat perde 42 pontos de vida devido ao seu ataque.',
    ]);
  });
});
