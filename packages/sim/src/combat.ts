import { getMonster, getVocation, itemsById, stages, type CombatType, type Monster } from '@tibia-idle/data';
import { huntThroughput } from './throughput.js';
import { Rng } from './rng.js';
import {
  applyDefenses, applyElementalResistance, baseDamageHealing,
  canReceiveLoot, lootCount, lootFactor, monsterMitigation, rollLootEntry,
  stageMultiplier, staminaMultiplier,
} from './formulas.js';
import {
  addExperience, addManaSpent, addSkillTries, deriveStats, isDistanceVocation, pruneExpiredImbuements, weaponDamageRange,
} from './character.js';
import { chooseSpell, healAmount, HEAL_SPELLS, isSpellGroupReady, magicDamageRange, spellDamage, spellEffect, spellShoot, tickSpellCooldowns, weaponMissile, type SpellGroup } from './spells.js';
import { wandAttack } from './wands.js';
import { attackEffectFor } from './attackEffects.js';
import { chooseRune, runeDamage } from './runes.js';
import { applyCondition, clearCondition, tickConditions } from './conditions.js';
import { applySupport, foodRegenBonus, hasteKite, helperIncomingDamageMult, helperOutgoingDamageMult, tickBuffs } from './support.js';
import {
  ammoDamageRange, ammoProfile, ammoSplashVictims, layoutPackMonsters, splitAmmoDamage,
} from './ammo.js';
import { distanceHitChance } from './accuracy.js';
import { spellSplashVictims, spellAreaTargetCount } from './spellAreas.js';
import { combatAreaDirection, meleeSurroundSpots, PLAYER_TILE } from './areas.js';
import {
  ammoToConsume, bestSpiritPotion, HEALTH_POTION_TIERS, isSpiritVocation,
  MANA_POTION_TIERS, supplyUnitCost, type PotionTier,
} from './supplies.js';
import {
  absorbPercent, consumeJewelryCharges, jewelryHud, jewelryMagicShield, jewelryRegen, tickJewelry,
} from './jewelry.js';
import { imbueDamageConvert, imbueSpeedBonus, imbueVibrancyChance } from './imbuements.js';
import { huntMultipliers } from './progression.js';
import {
  charmStrike, charmPassive, charmDodgePercent, charmParryReflect, charmCleanse, charmAdrenalineBurst, charmCarnageDamage,
  charmCrippleParalyze, charmNumbParalyze, charmFatalHold, CHARM_PARALYZE_MS, FATAL_HOLD_MS,
} from './charms.js';
import {
  chooseSoulAttackRune, chooseSupportRune, spawnSkeleton,
} from './soulRunes.js';
import {
  addHarmony, spendHarmony, harmonyDamageMultiplier,
} from './harmony.js';
import { rollForgeDustOnKill } from './forge.js';
import {
  COMBO_CAP, COMBO_WINDOW_TICKS, FATAL_DAMAGE, combatProcs, comboMultiplier, leechAmount,
  AVATAR_FORGE_CRIT_CHANCE, AVATAR_FORGE_CRIT_EXTRA, AVATAR_FORGE_DAMAGE_REDUCTION,
  TRANSCENDENCE_AVATAR_MS,
} from './procs.js';
import {
  emptyTotals, TICK_MS, TICKS_PER_HOUR, normalizeSession, policyForMode, policyForWave,
  type ActiveMonster, type CharacterState, type DerivedStats,
  type HuntSession, type SimEvent, type SimRates,
} from './types.js';
import { DEFAULT_RATES } from './types.js';
import { isMoneyItem, moneyUnitValue, pouchHasRoom, sessionWeight } from './loot.js';
import { applyDeathPenalty } from './blessings.js';
import { creditTaskKill } from './tasks.js';
import {
  BOSS_HEALTH_MULT, BOSS_REWARD_MULT, WAVE_CYCLE_KILLS, WAVE_PACK_CAP, WAVES_TOTAL, isBossWave, wavePackSize, waveProgress,
} from './waves.js';
import { isBossHunt } from './bossEncounters.js';

const NORMAL_WAVE_DELAY_MS = 3_000;
const BOSS_WAVE_DELAY_MS = 5_000;
type WaveTimingSession = HuntSession & { nextWaveAtTick?: number };

function sessionNow(session: HuntSession): number {
  return (session.startedAt ?? 0) + session.tick * TICK_MS;
}

function sessionMultipliers(session: HuntSession, monsterId: string) {
  return huntMultipliers(
    session.character,
    monsterId,
    sessionNow(session),
    (session.partyMembers ?? []).map((member) => member.level),
    session.boostedMonsterId,
  );
}

/**
 * Tick-based hunt simulation.
 *
 * The loop is deliberately plain and allocation-light: it runs on the server to
 * settle sessions and in the browser to animate them, and both must produce
 * identical output from the same seed. Every random draw goes through the
 * session's `Rng`, and the draw *order* is part of the contract - reordering
 * calls changes results even though the logic looks the same.
 */

/** How the abstract hunting zone turns into a concrete fight. */
export interface HuntTuning {
  /** Monsters engaged simultaneously. Defaults to the zone's own density. */
  packSize?: number;
  /**
   * Fraction of a melee monster's attacks that land on a character fighting at
   * range.
   *
   * The simulation has no map, so nothing otherwise stops a rat from hitting a
   * sorcerer who would, on a real map, simply walk away. Without this a caster
   * takes full melee damage all hunt and cannot survive zones they clear
   * comfortably in the real game.
   */
  rangedExposure: number;
  /**
   * Scales the zone's spawn budget. 1 is the official rate; a party splits the
   * same budget between more characters.
   */
  spawnRate: number;
}

export const DEFAULT_TUNING: HuntTuning = {
  rangedExposure: 0.4,
  spawnRate: 1,
};

type CombatRates = SimRates & {
  awardKillExperience?: (session: HuntSession, amount: number, emit: (event: SimEvent) => void) => void;
};

export interface AdvanceOptions {
  /** Server party settlement can distribute a kill before combat continues. */
  awardKillExperience?: CombatRates['awardKillExperience'];
  rates?: SimRates;
  tuning?: HuntTuning;
  /** Cap on returned events. The simulation still runs in full. */
  maxEvents?: number;
  /**
   * Crystal runOnHealth flee. Off by default for idle hunts (flee emptied the
   * floor and instantly refilled → pack “reset” every few hits). Calibration
   * can opt in with `creatureFlee: true`.
   */
  creatureFlee?: boolean;
}

export function startSession(
  character: CharacterState,
  huntId: string,
  seed: number | bigint,
): HuntSession {
  // Throws for an unknown hunt, so a bad id fails here rather than mid-session.
  const throughput = huntThroughput(huntId);
  const rng = new Rng(seed);
  const bossFight = isBossHunt(huntId);
  const packSize = bossFight ? 1 : wavePackSize(0);
  const session: HuntSession = {
    huntId,
    tick: 0,
    rngState: rng.getState(),
    character,
    active: [],
    nextUid: 1,
    playerAttackCooldown: 0,
    spellCooldowns: {},
    regenCounterHealth: 0,
    regenCounterMana: 0,
    spawnCredits: 0,
    /** Wave 1 is on the floor at hunt start; this shaves the same amount off the first respawn gate. */
    initialPackCredit: 0,
    totals: emptyTotals(),
    status: 'active',
    combo: 0,
    comboTick: 0,
    partyMembers: [],
    hasteTicks: 0,
    foodTicks: 0,
    magicShieldTicks: 0,
    soulAccMs: 0,
    conditions: [],
  };
  // The room is already populated when you walk in, like the real client.
  // Respawn after that still spends the zone's spawn budget.
  for (let i = 0; i < packSize; i += 1) {
    const monster = bossFight
      ? throughput.monsters[0]
      : pickSpawnMonster(session, throughput.monsters, rng);
    if (!monster) break;
    session.active.push(spawn(session, monster));
  }
  layoutPackMonsters(session.active);
  if (!bossFight) session.initialPackCredit = packSize;
  session.rngState = rng.getState();
  return session;
}

function spawn(session: HuntSession, monster: Monster): ActiveMonster {
  const bossFight = isBossHunt(session.huntId);
  const bossWave = isBossWave(waveProgress(session.totals.kills).waveIndex);
  const health = bossFight
    ? monster.health
    : bossWave
      ? Math.max(1, Math.round(monster.health * BOSS_HEALTH_MULT))
      : monster.health;
  const [spawnTile] = meleeSurroundSpots(PLAYER_TILE.x, PLAYER_TILE.y);
  const active: ActiveMonster = {
    uid: session.nextUid++,
    monsterId: monster.id,
    health,
    maxHealth: health,
    tileX: spawnTile?.x ?? PLAYER_TILE.x,
    tileY: spawnTile?.y ?? PLAYER_TILE.y + 2,
    attackCooldowns: monster.attacks.map(() => 0),
    healCooldown: 0,
  };
  return active;
}

/** Wave 10 is one copy of the cave's own creature, just tankier. */
function pickSpawnMonster(session: HuntSession, pool: Monster[], rng: Rng): Monster | undefined {
  if (pool.length === 0) return undefined;
  if (!isBossWave(waveProgress(session.totals.kills).waveIndex)) return rng.pick(pool);
  const regular = pool.filter((monster) => !monster.isBoss);
  const cave = regular.length > 0 ? regular : pool;
  return cave.reduce((best, monster) => (monster.health > best.health ? monster : best));
}

/** 0–9 cycle matching the HUD: 9 is the skull / boss wave. */
export function huntWave(session: HuntSession): number {
  return waveProgress(session.totals.kills).waveIndex;
}

function msToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / TICK_MS));
}

/** Strongest potion the character is carrying that they are allowed to drink. */
function bestPotion(character: CharacterState, tiers: readonly PotionTier[], policy = character.policy): PotionTier | null {
  const preferredId = tiers === HEALTH_POTION_TIERS
    ? policy.healthPotionId
    : policy.manaPotionId;
  if (preferredId > 0) {
    const preferred = tiers.find((tier) => tier.itemId === preferredId);
    if (preferred && character.level >= preferred.level
      && character.supplies.some((stack) => stack.itemId === preferred.itemId && stack.count > 0)) {
      return preferred;
    }
  }
  for (let i = tiers.length - 1; i >= 0; i -= 1) {
    const potion = tiers[i];
    if (!potion || character.level < potion.level) continue;
    if (character.supplies.some((s) => s.itemId === potion.itemId && s.count > 0)) return potion;
  }
  return null;
}

function consume(session: HuntSession, itemId: number): boolean {
  const stack = session.character.supplies.find((s) => s.itemId === itemId);
  if (!stack || stack.count <= 0) return false;
  stack.count -= 1;
  session.totals.supplyValue += supplyUnitCost(itemId);
  session.totals.suppliesByItem[itemId] = (session.totals.suppliesByItem[itemId] ?? 0) + 1;
  return true;
}

function ensureSessionBuffs(session: HuntSession): void {
  normalizeSession(session);
  session.hasteTicks ??= 0;
  session.foodTicks ??= 0;
  session.magicShieldTicks ??= 0;
  session.playerParalyzeTicks ??= 0;
  session.avatarTicks ??= 0;
  session.soulAccMs ??= 0;
  session.conditions ??= [];
  if (!session.totals) session.totals = emptyTotals();
  session.totals.avatars ??= 0;
}

/** Idle proxy for Crystal `Player::triggerTranscendence` (legs tier → avatar forge). */
function tickTranscendence(
  session: HuntSession,
  rng: Rng,
  emit: (event: SimEvent) => void,
): void {
  if ((session.avatarTicks ?? 0) > 0) {
    session.avatarTicks = Math.max(0, (session.avatarTicks ?? 0) - 1);
    return;
  }
  if (session.active.length === 0) return;

  // Crystal: onThink every ~interval, only on even wall-clock seconds.
  const secondTicks = Math.max(1, Math.round(1000 / TICK_MS));
  if (session.tick % secondTicks !== 0) return;
  const elapsedSec = Math.floor((session.tick * TICK_MS) / 1000);
  if (elapsedSec % 2 !== 0) return;

  const procs = combatProcs(session.character, sessionNow(session));
  if (procs.transcendenceChance <= 0) return;
  // Crystal: uniform_random(0, 10000) / 100. < chance
  if (rng.uniform(0, 10000) / 100 >= procs.transcendenceChance) return;

  session.avatarTicks = msToTicks(TRANSCENDENCE_AVATAR_MS);
  session.totals.avatars = (session.totals.avatars ?? 0) + 1;
  emit({
    tick: session.tick,
    type: 'buff',
    words: 'transcendence',
    amount: TRANSCENDENCE_AVATAR_MS,
  });
}

function isAvatarForgeActive(session: HuntSession): boolean {
  return (session.avatarTicks ?? 0) > 0;
}

function isMonsterParalyzeAttack(name: string, kind: string): boolean {
  return kind === 'other' && /paralyze/i.test(name);
}

/** Idle proxy duration for monster `* paralyze` scripts (Crystal CONDITION_PARALYZE). */
export const MONSTER_PARALYZE_MS = 4_000;

/**
 * Advance the session by `ticks`.
 *
 * Returns the events produced. Mutates the session in place, including its RNG
 * state, so calling this twice with the same arguments continues rather than
 * repeats.
 */
export function advance(session: HuntSession, ticks: number, options: AdvanceOptions = {}): SimEvent[] {
  const rates: CombatRates = { ...(options.rates ?? DEFAULT_RATES), awardKillExperience: options.awardKillExperience };
  const tuning = options.tuning ?? DEFAULT_TUNING;
  const maxEvents = options.maxEvents ?? 5000;
  session.creatureFlee = options.creatureFlee === true;

  const rng = new Rng(0);
  rng.setState(session.rngState);

  const events: SimEvent[] = [];
  const emit = (event: SimEvent): void => {
    if (events.length < maxEvents) events.push(event);
  };

  const throughput = huntThroughput(session.huntId);
  const spawnRate = tuning.spawnRate;
  const pool = throughput.monsters;
  if (pool.length === 0) {
    session.status = 'stopped';
    return events;
  }

  const character = session.character;
  let stats = deriveStats(character);
  // `advance` can be called either once for a whole offline settlement or in
  // small browser frames. Skills and magic level can increase during combat;
  // refreshing only at the next call made results depend on that call size.
  // Keep the derived combat stats in sync on the tick after any relevant level
  // changes, irrespective of how the caller chunks the simulation.
  let levelAtLastDerive = character.level;
  let magicLevelAtLastDerive = character.magicLevel;
  let skillsAtLastDerive = skillLevels(character);

  for (let step = 0; step < ticks && session.status === 'active'; step += 1) {
    session.tick += 1;
    session.totals.ticks += 1;
    const policy = isBossHunt(session.huntId)
      ? policyForMode(character, 'boss')
      : policyForWave(character, huntWave(session));

    ensureSessionBuffs(session);
    tickBuffs(session);
    tickTranscendence(session, rng, emit);
    tickJewelry(session, emit);
    regenerate(session, stats);
    regenSouls(session);
    pruneExpiredImbuements(session.character, sessionNow(session));
    applySupport(session, emit, (itemId) => consume(session, itemId), policy);
    tickConditions(session, emit);
    applyPolicy(session, stats, rng, emit, policy);
    if (session.status !== 'active') break;

    // Keep stand tiles on the surround ring so burst/diamond splash is
    // centered on the impact SQM (Crystal createCombatArea), not the whole floor.
    layoutPackMonsters(session.active);
    playerTurn(session, stats, rates, rng, emit, policy);
    tickMonsterDots(session, rng, emit, rates);
    summonTurn(session, rng, emit, rates);
    tryChallenge(session, pool, rng, emit, policy);
    refillPack(session, pool, throughput.killsPerHour, spawnRate, rng, emit);
    monsterTurn(session, stats, tuning, rng, emit);

    // Levelling, skill tries and mana spent can all alter next-tick combat
    // stats. This must not depend on the outer `advance` call boundary.
    if (
      character.level !== levelAtLastDerive
      || character.magicLevel !== magicLevelAtLastDerive
      || skillLevelsChanged(character, skillsAtLastDerive)
    ) {
      stats = deriveStats(character);
      levelAtLastDerive = character.level;
      magicLevelAtLastDerive = character.magicLevel;
      skillsAtLastDerive = skillLevels(character);
    }

    // Stamina drains one minute per minute of hunting.
    if (session.tick % Math.round(60_000 / TICK_MS) === 0) {
      character.stamina = Math.max(0, character.stamina - 1);
      if (character.stamina === 0) {
        session.status = 'no_stamina';
        emit({ tick: session.tick, type: 'stamina_depleted' });
      }
    }

    if (character.health <= 0) {
      const penalty = applyDeathPenalty(character, session);
      session.lastDeathPenalty = penalty;
      session.totals.deaths += 1;
      session.status = 'died';
      emit({
        tick: session.tick,
        type: 'player_death',
        amount: penalty.lost,
        level: penalty.blessingsUsed,
        itemId: penalty.aolUsed ? 3057 : undefined,
        count: penalty.pouchLost,
        skill: penalty.skillsLost > 0 ? String(penalty.skillsLost) : undefined,
      });
    }
  }

  session.rngState = rng.getState();
  return events;
}

function skillLevels(character: CharacterState): number[] {
  return [
    character.skills.fist?.level ?? 0,
    character.skills.club?.level ?? 0,
    character.skills.sword?.level ?? 0,
    character.skills.axe?.level ?? 0,
    character.skills.distance?.level ?? 0,
    character.skills.shield?.level ?? 0,
    character.skills.fishing?.level ?? 0,
  ];
}

function skillLevelsChanged(character: CharacterState, previous: readonly number[]): boolean {
  // This sits in the hot tick loop. Avoid building a fresh array for every
  // tick; a long offline settlement executes this check thousands of times.
  return (
    (character.skills.fist?.level ?? 0) !== previous[0]
    || (character.skills.club?.level ?? 0) !== previous[1]
    || (character.skills.sword?.level ?? 0) !== previous[2]
    || (character.skills.axe?.level ?? 0) !== previous[3]
    || (character.skills.distance?.level ?? 0) !== previous[4]
    || (character.skills.shield?.level ?? 0) !== previous[5]
    || (character.skills.fishing?.level ?? 0) !== previous[6]
  );
}

function regenSouls(session: HuntSession): void {
  const character = session.character;
  const vocation = getVocation(character.vocationId);
  const cap = vocation.soulMax;
  character.soul = Math.min(cap, Math.max(0, character.soul ?? 0));
  if (character.soul >= cap || vocation.gainSoulTicks <= 0) return;
  session.soulAccMs = (session.soulAccMs ?? 0) + TICK_MS;
  while (session.soulAccMs >= vocation.gainSoulTicks && character.soul < cap) {
    session.soulAccMs -= vocation.gainSoulTicks;
    character.soul += 1;
  }
}

function regenerate(session: HuntSession, stats: DerivedStats): void {
  const character = session.character;
  const fed = foodRegenBonus(session);
  const jewellery = jewelryRegen(character);
  session.regenCounterHealth += stats.healthRegenPerTick * fed + jewellery.health;
  session.regenCounterMana += stats.manaRegenPerTick * fed + jewellery.mana;

  const healthGain = Math.floor(session.regenCounterHealth);
  if (healthGain > 0) {
    session.regenCounterHealth -= healthGain;
    character.health = Math.min(stats.maxHealth, character.health + healthGain);
  }
  const manaGain = Math.floor(session.regenCounterMana);
  if (manaGain > 0) {
    session.regenCounterMana -= manaGain;
    character.mana = Math.min(stats.maxMana, character.mana + manaGain);
  }
}

/** Crystal healing exhaust between drinks and heal spells. */
const HEAL_EXHAUST_MS = 1000;

/** Potions and the retreat threshold. */
function applyPolicy(
  session: HuntSession,
  stats: DerivedStats,
  rng: Rng,
  emit: (event: SimEvent) => void,
  policy = session.character.policy,
): void {
  const character = session.character;
  const healthFraction = character.health / stats.maxHealth;

  if ((session.healCooldownTicks ?? 0) > 0) {
    session.healCooldownTicks = (session.healCooldownTicks ?? 0) - 1;
  }

  if (policy.healSpellId && healthFraction < (policy.healSpellAt ?? 0.7)
    && (session.healCooldownTicks ?? 0) <= 0) {
    const heal = HEAL_SPELLS.find((spell) => spell.id === policy.healSpellId);
    if (heal && character.level >= heal.level && character.mana >= heal.mana) {
      character.mana -= heal.mana;
      const range = healAmount(heal, character.level, character.magicLevel);
      const healed = Math.min(rng.normal(range.min, range.max), stats.maxHealth - character.health);
      character.health += healed;
      session.totals.healingDone += healed;
      addManaSpent(character, heal.mana, stageMultiplier(stages.magicLevel, character.magicLevel));
      session.healCooldownTicks = msToTicks(HEAL_EXHAUST_MS);
      emit({ tick: session.tick, type: 'heal', amount: healed, words: heal.words });
    }
  }

  const hpLow = character.health / stats.maxHealth < policy.healthPotionAt;
  const usedSpirit = policy.spiritPotionId >= 0 && isSpiritVocation(character.vocationId) && hpLow
    && (session.healCooldownTicks ?? 0) <= 0
    && (() => {
      const spirit = bestSpiritPotion(character, policy.spiritPotionId);
      if (!spirit || !consume(session, spirit.itemId)) return false;
      const healed = Math.min(rng.uniform(spirit.min, spirit.max), stats.maxHealth - character.health);
      const mana = Math.min(rng.uniform(spirit.manaMin, spirit.manaMax), stats.maxMana - character.mana);
      character.health += healed;
      character.mana += mana;
      session.totals.healingDone += healed;
      session.totals.potionsUsed += 1;
      session.healCooldownTicks = msToTicks(HEAL_EXHAUST_MS);
      emit({ tick: session.tick, type: 'potion', itemId: spirit.itemId, amount: healed + mana });
      return true;
    })();

  if (!usedSpirit && policy.healthPotionId >= 0 && hpLow && (session.healCooldownTicks ?? 0) <= 0) {
    const potion = bestPotion(character, HEALTH_POTION_TIERS, policy);
    if (potion && consume(session, potion.itemId)) {
      const healed = Math.min(rng.uniform(potion.min, potion.max), stats.maxHealth - character.health);
      character.health += healed;
      session.totals.healingDone += healed;
      session.totals.potionsUsed += 1;
      session.healCooldownTicks = msToTicks(HEAL_EXHAUST_MS);
      emit({ tick: session.tick, type: 'potion', itemId: potion.itemId, amount: healed });
    } else if (policy.stopWhenOutOfSupplies) {
      session.status = 'out_of_supplies';
      emit({ tick: session.tick, type: 'out_of_supplies' });
      return;
    }
  }

  if (character.health / stats.maxHealth < policy.fleeAt) {
    session.status = 'fled';
    emit({ tick: session.tick, type: 'fled' });
    return;
  }

  if (policy.manaPotionId >= 0 && character.mana / stats.maxMana < policy.manaPotionAt
    && (session.healCooldownTicks ?? 0) <= 0) {
    const potion = bestPotion(character, MANA_POTION_TIERS, policy);
    if (potion && consume(session, potion.itemId)) {
      const restored = Math.min(rng.uniform(potion.min, potion.max), stats.maxMana - character.mana);
      character.mana += restored;
      session.totals.potionsUsed += 1;
      session.healCooldownTicks = msToTicks(HEAL_EXHAUST_MS);
      emit({ tick: session.tick, type: 'potion', itemId: potion.itemId, amount: restored });
    }
  }
}

/**
 * Keep each wave pack fixed. Once the floor is clear, normal waves wait 3s and
 * the skull/boss wave waits 5s before the next complete pack is released.
 * Spawn credits still accrue for compatibility and balancing telemetry, but
 * they no longer create long empty-floor waits for fast characters or parties.
 */
function refillPack(
  session: HuntSession,
  pool: Monster[],
  killsPerHour: number,
  spawnRate: number,
  rng: Rng,
  emit: (event: SimEvent) => void,
): void {
  if (isBossHunt(session.huntId)) return;
  const progress = waveProgress(session.totals.kills);
  const timed = session as WaveTimingSession;

  session.spawnCredits = Math.min(
    progress.size,
    session.spawnCredits + killsPerHour * Math.max(0, spawnRate) / TICKS_PER_HOUR,
  );

  if (session.active.length > 0) {
    timed.nextWaveAtTick = undefined;
    return;
  }

  const toSpawn = Math.max(0, progress.size - progress.killed);
  if (toSpawn <= 0) return;

  if (timed.nextWaveAtTick === undefined) {
    const delayMs = isBossWave(progress.waveIndex) ? BOSS_WAVE_DELAY_MS : NORMAL_WAVE_DELAY_MS;
    timed.nextWaveAtTick = session.tick + msToTicks(delayMs) - 1;
  }
  if (session.tick < timed.nextWaveAtTick) return;

  timed.nextWaveAtTick = undefined;
  session.spawnCredits = Math.max(0, session.spawnCredits - Math.min(session.spawnCredits, toSpawn));
  session.initialPackCredit = 0;
  for (let i = 0; i < toSpawn; i += 1) {
    const monster = pickSpawnMonster(session, pool, rng);
    if (!monster) break;
    const active = spawn(session, monster);
    session.active.push(active);
    emit({ tick: session.tick, type: 'monster_spawn', uid: active.uid, monsterId: monster.id });
  }
  layoutPackMonsters(session.active);
}

/** exeta res — challenge pulls one extra creature when the wave still has room. */
function tryChallenge(
  session: HuntSession,
  pool: Monster[],
  rng: Rng,
  emit: (event: SimEvent) => void,
  policy = session.character.policy,
): void {
  if (isBossHunt(session.huntId)) return;
  if (!policy.taunt) return;
  if (session.active.length === 0) return;
  const voc = session.character.vocationId;
  if (voc !== 4 && voc !== 8) return;
  if (session.character.level < 20 || session.character.mana < 30) return;
  session.spellCooldowns ??= {};
  if (!isSpellGroupReady(session.spellCooldowns, 'support')) return;

  const progress = waveProgress(session.totals.kills);
  const remaining = progress.size - progress.killed - session.active.length;
  if (remaining <= 0) return;

  session.character.mana -= 30;
  session.spellCooldowns.support = msToTicks(2000);
  emit({ tick: session.tick, type: 'buff', words: 'exeta res', amount: 0 });

  const monster = pickSpawnMonster(session, pool, rng);
  if (!monster) return;
  const active = spawn(session, monster);
  session.active.push(active);
  emit({ tick: session.tick, type: 'monster_spawn', uid: active.uid, monsterId: monster.id });
  layoutPackMonsters(session.active);
}

function setSpellGroupCooldown(session: HuntSession, group: SpellGroup, cooldownMs: number): void {
  session.spellCooldowns ??= {};
  session.spellCooldowns[group] = msToTicks(cooldownMs);
}

function playerTurn(
  session: HuntSession,
  stats: DerivedStats,
  rates: CombatRates,
  rng: Rng,
  emit: (event: SimEvent) => void,
  policy = session.character.policy,
): void {
  const now = sessionNow(session);
  session.spellCooldowns ??= {};
  tickSpellCooldowns(session.spellCooldowns);
  const groupReady = (group: SpellGroup) => isSpellGroupReady(session.spellCooldowns!, group);

  if (session.active.length === 0) {
    if (session.playerAttackCooldown > 0) session.playerAttackCooldown -= 1;
    return;
  }

  const character = session.character;
  const weaponRange = weaponDamageRange(character, stats);
  const procs = combatProcs(character, now);

  const spell = chooseSpell(
    character.vocationId,
    character.level,
    character.mana,
    session.active.length,
    policy,
    groupReady,
    character.harmony ?? 0,
  );
  const rune = groupReady('attack') ? chooseRune(character, policy, session.active.length) : null;
  const soulRune = groupReady('attack') ? chooseSoulAttackRune(character, policy) : null;
  const spellHits = spell
    ? (spell.area ? spellAreaTargetCount(session.active, spell.areaShape ?? 'square1') : 1)
    : 0;
  const runeHits = rune ? (rune.area ? session.active.length : 1) : 0;
  const spellScore = spell ? (spell.basePower * Math.max(1, spellHits)) / (spell.cooldown / 1000) : 0;
  const runeScore = rune ? (rune.basePower * Math.max(1, runeHits)) / (rune.cooldown / 1000) : 0;
  const soulScore = soulRune
    ? (soulRune.basePower + soulRune.dotDamage * soulRune.dotTicks) / (soulRune.cooldown / 1000)
    : 0;
  const throwRune = Boolean(rune && runeScore >= spellScore && runeScore >= soulScore && consume(session, rune.itemId));
  const throwSoul = Boolean(!throwRune && soulRune && soulScore >= spellScore && consume(session, soulRune.itemId));

  if (throwRune && rune) {
    const range = runeDamage(rune, character.level, procs.magicLevel);
    const focus = session.active[0]!;
    const targets = rune.area ? [...session.active] : [focus];
    emit({
      tick: session.tick, type: 'player_attack', itemId: rune.itemId,
      uid: focus.uid, area: rune.area || undefined,
    });
    for (const target of targets) {
      damageMonster(
        session, target, rng.normal(range.min, range.max), rune.damageType, rng, emit, rates, now,
        rune.area ? undefined : rune.shoot,
        rune.itemId,
      );
    }
    setSpellGroupCooldown(session, 'attack', rune.cooldown);
  } else if (throwSoul && soulRune) {
    character.soul = Math.max(0, (character.soul ?? 0) - soulRune.soulCost);
    const range = magicDamageRange(baseDamageHealing(character.level), procs.magicLevel, soulRune.basePower);
    const target = session.active[0]!;
    emit({ tick: session.tick, type: 'player_attack', itemId: soulRune.itemId });
    damageMonster(session, target, rng.normal(range.min, range.max), soulRune.damageType, rng, emit, rates, now, soulRune.shoot, soulRune.itemId);
    target.dot = {
      damage: soulRune.dotDamage,
      ticksLeft: soulRune.dotTicks,
      intervalTicks: msToTicks(soulRune.dotIntervalMs),
      nextTick: msToTicks(soulRune.dotIntervalMs),
      damageType: soulRune.damageType,
    };
    setSpellGroupCooldown(session, 'attack', soulRune.cooldown);
  } else if (spell) {
    character.mana -= spell.mana;
    const magicRate = rates.magic * stageMultiplier(stages.magicLevel, procs.magicLevel);
    addManaSpent(character, spell.mana, magicRate);

    let range = spellDamage(
      spell,
      character.level,
      procs.magicLevel,
      baseDamageHealing,
      weaponRange,
      { attackSkill: stats.attackSkill, weaponDamage: stats.attackValue },
    );
    if (spell.harmony === 'spend') {
      const stacks = character.harmony ?? 0;
      const multi = harmonyDamageMultiplier(stacks, character.virtueHarmony);
      range = { min: Math.floor(range.min * multi), max: Math.floor(range.max * multi) };
      character.harmony = spendHarmony(character.virtueHarmony);
    }
    const focus = session.active[0]!;
    layoutPackMonsters(session.active);
    const areaShape = spell.areaShape ?? 'square1';
    const areaDirection = spell.area ? combatAreaDirection(focus.tileX, focus.tileY) : undefined;
    const targets = spell.area
      ? spellSplashVictims(session.active, areaShape, areaDirection)
      : [focus];
    const missile = spellShoot(spell);
    const effect = spellEffect(spell);
    emit({
      tick: session.tick,
      type: 'player_attack',
      words: spell.words,
      effect,
      area: spell.area || undefined,
      areaShape: spell.areaShape,
      areaDirection,
      shoot: missile,
    });
    for (const target of targets) {
      damageMonster(
        session,
        target,
        rng.normal(range.min, range.max),
        spell.damageType,
        rng,
        emit,
        rates,
        now,
        undefined,
        undefined,
        spell.area ? { area: true } : undefined,
      );
    }
    if (spell.harmony === 'build') {
      character.harmony = addHarmony(character.harmony ?? 0, 1, character.virtueHarmony);
    }
    setSpellGroupCooldown(session, spell.group, spell.cooldown);
  }

  const support = groupReady('support')
    ? chooseSupportRune(character, policy, session.summons?.length ?? 0)
    : null;
  if (support && consume(session, support.itemId)) {
    character.soul = Math.max(0, (character.soul ?? 0) - support.soulCost);
    session.summons ??= [];
    session.summons.push(spawnSkeleton(session, support.durationMs));
    setSpellGroupCooldown(session, 'support', support.cooldown);
    emit({ tick: session.tick, type: 'buff', words: 'adana mort' });
  }

  if (policy.autoAttack === false) return;

  if (session.playerAttackCooldown > 0) {
    session.playerAttackCooldown -= 1;
    return;
  }
  const target = session.active[0];
  if (!target) return;

  if (stats.isMagic) {
    const wand = wandAttack(character);
    if (!wand) return;
    if (wand.mana > 0) {
      if (character.mana < wand.mana) {
        session.playerAttackCooldown = msToTicks(stats.attackSpeed);
        return;
      }
      character.mana -= wand.mana;
      const magicRate = rates.magic * stageMultiplier(stages.magicLevel, procs.magicLevel);
      addManaSpent(character, wand.mana, magicRate);
    }
    const rolled = rng.normal(wand.min, wand.max);
    damageMonster(session, target, rolled, wand.damageType, rng, emit, rates, now, wand.shoot);
    session.playerAttackCooldown = msToTicks(stats.attackSpeed);
    return;
  }

  if (isDistanceVocation(character.vocationId)) {
    const ammoId = ammoToConsume(character);
    if (!ammoId || !consume(session, ammoId)) {
      session.status = 'out_of_supplies';
      emit({ tick: session.tick, type: 'out_of_supplies' });
      return;
    }
    const profile = ammoProfile(ammoId);
    if (!profile) {
      session.playerAttackCooldown = msToTicks(stats.attackSpeed);
      return;
    }

    const hitChance = distanceHitChance(character, stats, profile);
    if (hitChance < 100 && rng.uniform(1, 100) > hitChance) {
      session.totals.misses ??= 0;
      session.totals.misses += 1;
      emit({
        tick: session.tick, type: 'player_attack', uid: target.uid,
        monsterId: target.monsterId, amount: 0, damageType: 'COMBAT_PHYSICALDAMAGE',
        missed: true, shoot: profile.shoot, itemId: ammoId,
      });
      session.playerAttackCooldown = msToTicks(stats.attackSpeed);
      return;
    }

    const range = ammoDamageRange(character, stats, profile);
    const areaAmmo = Boolean(profile.area && profile.areaShape);
    layoutPackMonsters(session.active);
    const victims = areaAmmo
      ? ammoSplashVictims(session.active, target, profile.areaShape!)
      : [target];

    if (areaAmmo) {
      emit({
        tick: session.tick,
        type: 'player_attack',
        uid: target.uid,
        monsterId: target.monsterId,
        itemId: ammoId,
        shoot: profile.shoot,
        effect: profile.effect,
        area: true,
        areaShape: profile.areaShape,
        impactX: target.tileX,
        impactY: target.tileY,
      });
    }

    let anyHit = false;
    let firstVictim = true;

    for (const victim of victims) {
      const rolled = rng.normal(range.min, range.max);
      const parts = splitAmmoDamage(profile, rolled);
      let firstPart = true;
      for (const part of parts) {
        if (part.amount <= 0) continue;
        anyHit = true;
        damageMonster(
          session,
          victim,
          part.amount,
          part.damageType,
          rng,
          emit,
          rates,
          now,
          !areaAmmo && firstVictim && firstPart ? profile.shoot : undefined,
          ammoId,
          areaAmmo
            ? { area: true }
            : (firstPart && profile.effect ? { effect: profile.effect } : undefined),
        );
        firstPart = false;
      }
      if (profile.poison && firstVictim && victim.health > 0) {
        victim.dot = {
          damage: profile.poison.damage,
          ticksLeft: profile.poison.ticks,
          intervalTicks: msToTicks(profile.poison.intervalMs),
          nextTick: msToTicks(profile.poison.intervalMs),
          damageType: profile.poison.damageType,
        };
      }
      firstVictim = false;
    }

    if (anyHit) {
      const skillRate = rates.skill * stageMultiplier(stages.skills, character.skills[stats.attackSkillName].level);
      const gained = addSkillTries(character, stats.attackSkillName, 1, skillRate);
      if (gained > 0) {
        emit({
          tick: session.tick, type: 'skill_up',
          skill: stats.attackSkillName, level: character.skills[stats.attackSkillName].level,
        });
      }
    }
    if (procs.momentumChance > 0 && rng.uniform(1, 100) < procs.momentumChance) {
      session.spellCooldowns ??= {};
      session.spellCooldowns.attack = 0;
    }
    session.playerAttackCooldown = msToTicks(stats.attackSpeed);
    return;
  }

  const rolled = rng.normal(weaponRange.min, weaponRange.max);
  damageMonster(
    session, target, rolled, 'COMBAT_PHYSICALDAMAGE', rng, emit, rates, now,
    weaponMissile(character), undefined, { autoAttack: true },
  );

  if (rolled > 0) {
    const skillRate = rates.skill * stageMultiplier(stages.skills, character.skills[stats.attackSkillName].level);
    const gained = addSkillTries(character, stats.attackSkillName, 1, skillRate);
    if (gained > 0) {
      emit({
        tick: session.tick, type: 'skill_up',
        skill: stats.attackSkillName, level: character.skills[stats.attackSkillName].level,
      });
    }
  }
  if (procs.momentumChance > 0 && rng.uniform(1, 100) < procs.momentumChance) {
    session.spellCooldowns ??= {};
    session.spellCooldowns.attack = 0;
  }
  session.playerAttackCooldown = msToTicks(stats.attackSpeed);
}

function tickMonsterDots(
  session: HuntSession,
  rng: Rng,
  emit: (event: SimEvent) => void,
  rates: CombatRates,
): void {
  const now = sessionNow(session);
  for (const target of session.active) {
    const dot = target.dot;
    if (!dot) continue;
    dot.nextTick -= 1;
    if (dot.nextTick <= 0 && dot.ticksLeft > 0) {
      damageMonster(session, target, dot.damage, dot.damageType, rng, emit, rates, now);
      dot.ticksLeft -= 1;
      dot.nextTick = dot.intervalTicks;
    }
    if (dot.ticksLeft <= 0) delete target.dot;
  }
}

function summonTurn(
  session: HuntSession,
  rng: Rng,
  emit: (event: SimEvent) => void,
  rates: CombatRates,
): void {
  const now = sessionNow(session);
  session.summons = (session.summons ?? []).filter((summon) => {
    summon.ticksLeft -= 1;
    return summon.ticksLeft > 0;
  });
  for (const summon of session.summons ?? []) {
    if (summon.attackCooldown > 0) {
      summon.attackCooldown -= 1;
      continue;
    }
    const target = session.active[0];
    if (!target) continue;
    summon.attackCooldown = msToTicks(2000);
    damageMonster(
      session, target, rng.normal(summon.minDamage, summon.maxDamage),
      summon.damageType ?? 'COMBAT_PHYSICALDAMAGE', rng, emit, rates, now,
    );
  }
}

function damageMonster(
  session: HuntSession,
  target: ActiveMonster,
  rawDamage: number,
  damageType: CombatType,
  rng: Rng,
  emit: (event: SimEvent) => void,
  rates: CombatRates = DEFAULT_RATES,
  now = sessionNow(session),
  shoot?: string,
  itemId?: number,
  hitMeta?: { effect?: string; area?: boolean; autoAttack?: boolean },
): void {
  const monster = getMonster(target.monsterId);

  if (monster.immunities.includes(damageType)) {
    const character = session.character;
    emit({
      tick: session.tick, type: 'player_attack', uid: target.uid, amount: 0, damageType,
      blocked: true, shoot, itemId, effect: hitMeta?.effect, area: hitMeta?.area,
      attackEffect: hitMeta?.autoAttack
        ? attackEffectFor(character.vocationId, character.equipment.left)
        : undefined,
    });
    return;
  }

  const character = session.character;
  const stats = deriveStats(character);
  const procs = combatProcs(character, now);
  session.combo ??= 0;
  session.comboTick ??= 0;
  session.totals.crits ??= 0;
  session.totals.fatals ??= 0;
  session.totals.leech ??= 0;
  session.totals.maxCombo ??= 0;

  let incoming = rawDamage;
  const strike = charmStrike(character, monster.id, target.maxHealth, rng, stats.maxMana, stats.maxHealth);
  incoming += strike.damage;
  if (strike.critBonus > 0) incoming *= 1 + strike.critBonus;
  const critChance = procs.critChance
    + charmPassive(character, monster.id).critChance
    + (isAvatarForgeActive(session) ? AVATAR_FORGE_CRIT_CHANCE : 0);
  const critExtra = procs.critExtra + (isAvatarForgeActive(session) ? AVATAR_FORGE_CRIT_EXTRA : 0);
  const critical = critChance > 0 && rng.uniform(1, 100) * 100 <= critChance;
  if (critical) {
    incoming *= 1 + critExtra / 10000;
    session.totals.crits += 1;
  }
  const fatal = procs.onslaughtChance > 0 && rng.uniform(1, 100) < procs.onslaughtChance;
  if (fatal) {
    incoming += Math.round(incoming * FATAL_DAMAGE);
    session.totals.fatals += 1;
  }

  if (session.tick - session.comboTick > COMBO_WINDOW_TICKS) session.combo = 0;
  session.combo = Math.min(COMBO_CAP, session.combo + 1);
  session.comboTick = session.tick;
  session.totals.maxCombo = Math.max(session.totals.maxCombo, session.combo);
  incoming *= comboMultiplier(session.combo);

  const wavePolicy = policyForWave(character, huntWave(session));
  const physical = damageType === 'COMBAT_PHYSICALDAMAGE';
  const distance = isDistanceVocation(character.vocationId) && physical;
  incoming *= helperOutgoingDamageMult(session, wavePolicy, physical, distance);

  const boost = sessionMultipliers(session, monster.id).damage;
  const mitigation = monsterMitigation(monster.mitigation);
  const convert = damageType === 'COMBAT_PHYSICALDAMAGE'
    ? imbueDamageConvert(character, now)
    : null;

  let final = 0;
  let resultType: CombatType = damageType;
  if (convert && convert.percent > 0) {
    const pct = Math.min(100, convert.percent) / 100;
    const physRaw = incoming * (1 - pct);
    const elemRaw = incoming * pct;
    const physResisted = applyElementalResistance(physRaw, monster.elements.COMBAT_PHYSICALDAMAGE ?? 0) * boost;
    final += applyDefenses(
      physResisted,
      {
        defense: monster.defense,
        armor: monster.armor,
        mitigation,
        canUseDefense: true,
      },
      rng,
    );
    if (!monster.immunities.includes(convert.combat)) {
      const elemResisted = applyElementalResistance(elemRaw, monster.elements[convert.combat] ?? 0) * boost;
      final += applyDefenses(
        elemResisted,
        {
          defense: monster.defense,
          armor: 0,
          mitigation,
          canUseDefense: false,
        },
        rng,
      );
      resultType = convert.combat;
    }
  } else {
    const resisted = applyElementalResistance(incoming, monster.elements[damageType] ?? 0);
    const boosted = resisted * boost;
    const physical = damageType === 'COMBAT_PHYSICALDAMAGE';
    final = applyDefenses(
      boosted,
      {
        defense: monster.defense,
        armor: physical ? monster.armor : 0,
        mitigation,
        canUseDefense: physical,
      },
      rng,
    );
  }

  target.health -= final;
  session.totals.damageDealt += final;

  let leeched = 0;
  if (final > 0 && procs.lifeLeech > 0 && rng.uniform(0, 100) < procs.lifeLeechChance) {
    const stats = deriveStats(character);
    leeched = Math.min(leechAmount(final, procs.lifeLeech), stats.maxHealth - character.health);
    character.health += leeched;
    session.totals.healingDone += leeched;
    session.totals.leech += leeched;
  }
  if (final > 0 && procs.manaLeech > 0 && rng.uniform(0, 100) < procs.manaLeechChance) {
    const stats = deriveStats(character);
    const restored = Math.min(leechAmount(final, procs.manaLeech), stats.maxMana - character.mana);
    character.mana += restored;
  }
  if (final > 0 && strike.leech > 0) {
    const stats = deriveStats(character);
    const charmLeech = Math.min(Math.floor(final * strike.leech), stats.maxHealth - character.health);
    if (charmLeech > 0) {
      character.health += charmLeech;
      session.totals.healingDone += charmLeech;
      session.totals.leech = (session.totals.leech ?? 0) + charmLeech;
      leeched += charmLeech;
    }
  }

  if (final > 0 && charmCrippleParalyze(character, monster.id, rng)) {
    target.paralyzeTicks = Math.max(target.paralyzeTicks ?? 0, msToTicks(CHARM_PARALYZE_MS));
  }

  if (final > 0 && charmFatalHold(character, monster.id, rng)) {
    target.holdTicks = Math.max(target.holdTicks ?? 0, msToTicks(FATAL_HOLD_MS));
  }

  emit({
    tick: session.tick, type: 'player_attack', uid: target.uid,
    monsterId: monster.id, amount: final, damageType: resultType, blocked: final === 0,
    critical, fatal, combo: session.combo, leech: leeched || undefined, shoot, itemId,
    effect: hitMeta?.effect, area: hitMeta?.area,
    attackEffect: hitMeta?.autoAttack
      ? attackEffectFor(character.vocationId, character.equipment.left)
      : undefined,
  });
  if (session.combo > 1 && session.combo % 5 === 0) {
    emit({ tick: session.tick, type: 'combo', combo: session.combo, amount: session.combo });
  }

  if (target.health <= 0) {
    killMonster(session, target, monster, rng, emit, rates);
    return;
  }

  let fleeAt = monster.runOnHealth ?? 0;
  if (fleeAt > 0 && isBossWave(huntWave(session))) {
    fleeAt = Math.max(1, Math.round(fleeAt * BOSS_HEALTH_MULT));
  }
  if (
    session.creatureFlee
    && fleeAt > 0
    && target.health <= fleeAt
    && (target.holdTicks ?? 0) <= 0
  ) {
    const index = session.active.indexOf(target);
    if (index >= 0) session.active.splice(index, 1);
    emit({ tick: session.tick, type: 'monster_flee', monsterId: monster.id, uid: target.uid });
  }
}

function killMonster(
  session: HuntSession,
  target: ActiveMonster,
  monster: Monster,
  rng: Rng,
  emit: (event: SimEvent) => void,
  rates: CombatRates = DEFAULT_RATES,
): void {
  const carnage = charmCarnageDamage(session.character, monster.id, target.maxHealth, rng);
  if (carnage > 0) {
    const now = sessionNow(session);
    for (const other of session.active) {
      if (other.uid === target.uid) continue;
      damageMonster(session, other, carnage, 'COMBAT_PHYSICALDAMAGE', rng, emit, rates, now);
    }
  }
  const index = session.active.indexOf(target);
  if (index >= 0) session.active.splice(index, 1);
  const bossFight = isBossHunt(session.huntId);
  const bossWave = isBossWave(huntWave(session));
  const boss = bossFight || bossWave;
  session.totals.kills += 1;
  session.character.bestiary ??= {};
  session.character.bestiary[monster.id] = (session.character.bestiary[monster.id] ?? 0) + 1;
  if (monster.isBoss) {
    session.character.bosstiary ??= {};
    session.character.bosstiary[monster.id] = (session.character.bosstiary[monster.id] ?? 0) + 1;
  }
  if (creditTaskKill(session.character, monster.id)) {
    const task = session.character.task;
    emit({
      tick: session.tick,
      type: 'task_complete',
      monsterId: monster.id,
      amount: task?.gold,
      count: task?.experience,
    });
  }
  emit({ tick: session.tick, type: 'monster_death', uid: target.uid, monsterId: monster.id });

  if (bossFight) {
    session.status = 'boss_cleared';
    emit({ tick: session.tick, type: 'boss_cleared', monsterId: monster.id });
  }

  const forgeDrop = rollForgeDustOnKill(session.character, rng, Boolean(monster.isBoss), monster.id);
  if (forgeDrop) {
    emit({
      tick: session.tick,
      type: 'forge_dust',
      monsterId: monster.id,
      amount: forgeDrop.dust,
      count: forgeDrop.slivers || undefined,
      words: forgeDrop.kind,
    });
  }

  const character = session.character;
  const stamina = staminaMultiplier(character.stamina, character.premium);
  const stage = stageMultiplier(stages.experience, character.level);
  const multi = sessionMultipliers(session, monster.id);
  const reward = bossFight ? 1 : bossWave ? BOSS_REWARD_MULT : 1;
  const gained = Math.floor(monster.experience * stage * stamina * multi.experience * rates.experience * reward);

  session.totals.rawExperience += monster.experience;
  if (rates.awardKillExperience) {
    rates.awardKillExperience(session, gained, emit);
  } else {
    session.totals.experience += gained;
    const levelUp = addExperience(character, gained);
    if (levelUp.levels > 0) {
      emit({ tick: session.tick, type: 'level_up', level: levelUp.newLevel });
    }
  }

  if (canReceiveLoot(character.stamina)) {
    rollLoot(session, monster, rng, emit, rates, reward);
  }
}

function rollLoot(
  session: HuntSession,
  monster: Monster,
  rng: Rng,
  emit: (event: SimEvent) => void,
  rates: CombatRates = DEFAULT_RATES,
  reward = 1,
): void {
  const factor = lootFactor(rng);
  const multis = sessionMultipliers(session, monster.id);
  const lootRate = rates.loot * reward;
  for (const drop of monster.loot) {
    const roll = rollLootEntry(drop.chance, factor, 1, rng);
    if (roll === null) continue;
    const item = itemsById.get(drop.itemId);
    const count = item?.stackable ? lootCount(roll, 1, drop.maxCount) : 1;
    const money = isMoneyItem(item);
    const unitValue = money && item ? moneyUnitValue(item) : (item?.sellPrice ?? 0);
    const valueMulti = (money ? multis.gold : multis.loot) * lootRate;
    const value = Math.floor(unitValue * count * valueMulti);
    const minKeep = session.character.policy.lootMinValue ?? 0;

    session.totals.lootValue += value;
    const junk = minKeep > 0 && unitValue < minKeep;
    if (money || junk || !pouchHasRoom(session, drop.itemId)) {
      session.character.gold += value;
    } else {
      session.totals.lootByItem[drop.itemId] = (session.totals.lootByItem[drop.itemId] ?? 0) + count;
    }
    emit({ tick: session.tick, type: 'loot', itemId: drop.itemId, count, amount: value });
  }
}

function monsterTurn(
  session: HuntSession,
  stats: DerivedStats,
  tuning: HuntTuning,
  rng: Rng,
  emit: (event: SimEvent) => void,
): void {
  const character = session.character;
  const wavePolicy = policyForWave(character, huntWave(session));
  const playerParalyzed = (session.playerParalyzeTicks ?? 0) > 0;
  if (playerParalyzed) {
    session.playerParalyzeTicks = Math.max(0, (session.playerParalyzeTicks ?? 0) - 1);
  }
  let exposure = stats.isMelee ? 1 : tuning.rangedExposure * hasteKite(session, stats.isMelee);
  if (playerParalyzed && !stats.isMelee) exposure = 1;

  for (const active of session.active) {
    const monster = getMonster(active.monsterId);

    if ((active.holdTicks ?? 0) > 0) {
      active.holdTicks = (active.holdTicks ?? 0) - 1;
    }

    if ((active.paralyzeTicks ?? 0) > 0) {
      active.paralyzeTicks = (active.paralyzeTicks ?? 0) - 1;
      for (let i = 0; i < active.attackCooldowns.length; i += 1) {
        const cooldown = active.attackCooldowns[i] ?? 0;
        if (cooldown > 0) active.attackCooldowns[i] = cooldown - 1;
      }
      if (active.healCooldown > 0) active.healCooldown -= 1;
      continue;
    }

    for (let i = 0; i < monster.attacks.length; i += 1) {
      const attack = monster.attacks[i];
      if (!attack) continue;
      const cooldown = active.attackCooldowns[i] ?? 0;
      if (cooldown > 0) {
        active.attackCooldowns[i] = cooldown - 1;
        continue;
      }
      active.attackCooldowns[i] = msToTicks(attack.interval);

      const reach = attack.range !== null && attack.range > 1 ? 1 : exposure;
      if (!rng.chance(attack.chance * reach)) continue;

      if (isMonsterParalyzeAttack(attack.name, attack.kind)) {
        const vibrancy = imbueVibrancyChance(character, sessionNow(session));
        if (vibrancy > 0 && rng.chance(vibrancy)) {
          emit({
            tick: session.tick, type: 'buff', words: 'vibrancy', amount: vibrancy,
            uid: active.uid, monsterId: monster.id,
          });
          continue;
        }
        session.playerParalyzeTicks = Math.max(
          session.playerParalyzeTicks ?? 0,
          msToTicks(MONSTER_PARALYZE_MS),
        );
        emit({
          tick: session.tick, type: 'monster_attack', uid: active.uid,
          monsterId: monster.id, amount: 0, damageType: attack.damageType,
          skill: 'paralyze', blocked: true,
          shoot: attack.shootEffect ?? undefined,
        });
        continue;
      }

      const rolled = rng.normal(attack.minDamage, attack.maxDamage);
      if (rolled <= 0) continue;

      const procs = combatProcs(character, sessionNow(session));
      session.totals.dodges ??= 0;
      const dodgeChance = procs.dodgeChance + charmDodgePercent(character, monster.id);
      if (dodgeChance > 0 && rng.uniform(0, 10000) < dodgeChance * 100) {
        session.totals.dodges += 1;
        emit({
          tick: session.tick, type: 'monster_attack', uid: active.uid,
          monsterId: monster.id, amount: 0, damageType: attack.damageType, blocked: true, dodged: true,
          shoot: attack.shootEffect ?? undefined,
        });
        continue;
      }

      const reduced = applyDefenses(
        rolled,
        {
          defense: stats.defense,
          armor: stats.armor,
          mitigation: stats.mitigation,
          absorbPercent: absorbPercent(character, attack.damageType),
          canUseDefense: attack.damageType === 'COMBAT_PHYSICALDAMAGE',
        },
        rng,
      );
      consumeJewelryCharges(session, attack.damageType, emit);
      let final = reduced * (1 - sessionMultipliers(session, monster.id).defense);
      final *= helperIncomingDamageMult(session, wavePolicy);
      const manaShield = jewelryMagicShield(character)
        || (
          (session.magicShieldTicks ?? 0) > 0
          && wavePolicy.magicShield
          && character.health / stats.maxHealth < (wavePolicy.magicShieldAt ?? 0.4)
        );
      if (manaShield && character.mana > 0) {
        const absorbed = Math.min(final, character.mana);
        character.mana -= absorbed;
        final -= absorbed;
      }

      const parried = charmParryReflect(character, monster.id, final, rng);
      if (parried > 0) {
        active.health -= parried;
        emit({
          tick: session.tick, type: 'player_attack', uid: active.uid,
          monsterId: monster.id, amount: parried, damageType: attack.damageType,
        });
      }

      if (isAvatarForgeActive(session) && final > 0) {
        final -= Math.ceil((final * AVATAR_FORGE_DAMAGE_REDUCTION) / 100);
        final = Math.max(0, final);
      }
      character.health -= final;
      session.totals.damageTaken += final;
      emit({
        tick: session.tick, type: 'monster_attack', uid: active.uid,
        monsterId: monster.id, amount: final, damageType: attack.damageType, blocked: final === 0,
        shoot: attack.shootEffect ?? undefined,
      });
      if (final > 0) {
        const cleared = charmCleanse(
          character,
          monster.id,
          (session.conditions ?? []).map((entry) => entry.id),
          rng,
        );
        if (cleared) clearCondition(session, cleared);
        if (charmAdrenalineBurst(character, monster.id, rng)) {
          session.hasteTicks = Math.max(session.hasteTicks ?? 0, msToTicks(10_000));
        }
        if (charmNumbParalyze(character, monster.id, rng)) {
          active.paralyzeTicks = Math.max(active.paralyzeTicks ?? 0, msToTicks(CHARM_PARALYZE_MS));
        }
      }
      if (attack.kind === 'combat' && final > 0) applyCondition(session, attack.damageType, final);

      if (attack.damageType === 'COMBAT_PHYSICALDAMAGE') {
        addSkillTries(character, 'shield', 1, stageMultiplier(stages.skills, character.skills.shield.level));
      }
    }

    for (const heal of monster.heals) {
      if (active.healCooldown > 0) {
        active.healCooldown -= 1;
        break;
      }
      active.healCooldown = msToTicks(heal.interval);
      if (!rng.chance(heal.chance)) break;
      const amount = rng.normal(heal.min, heal.max);
      active.health = Math.min(active.maxHealth, active.health + amount);
      break;
    }
  }
}

export function describeSession(session: HuntSession | null) {
  if (!session) return null;
  const rates = hourlyRates(session);
  const progress = waveProgress(session.totals.kills);
  const wavesCleared = Math.floor(session.totals.kills / WAVE_CYCLE_KILLS) * WAVES_TOTAL + progress.waveIndex;
  return {
    huntId: session.huntId,
    status: session.status,
    tick: session.tick,
    elapsedSeconds: Math.round((session.tick * TICK_MS) / 1000),
    hours: session.totals.ticks / TICKS_PER_HOUR,
    totals: session.totals,
    rates,
    wave: progress.waveIndex + 1,
    wavesTotal: WAVES_TOTAL,
    wavesCleared,
    bossWave: isBossWave(progress.waveIndex),
    packSize: progress.size,
    packAlive: session.active.length,
    packKilled: progress.killed,
    haste: (session.hasteTicks ?? 0) > 0,
    fed: (session.foodTicks ?? 0) > 0,
    utamo: (session.magicShieldTicks ?? 0) > 0,
    paralyzed: (session.playerParalyzeTicks ?? 0) > 0,
    avatar: isAvatarForgeActive(session),
    soul: session.character.soul ?? 0,
    soulMax: getVocation(session.character.vocationId).soulMax,
    harmony: session.character.harmony ?? 0,
    virtueHarmony: session.character.virtueHarmony ?? false,
    spellCooldowns: { ...(session.spellCooldowns ?? {}) },
    boosted: session.boostedMonsterId,
    conditions: (session.conditions ?? []).map((entry) => entry.id),
    capacityUsed: Math.round(sessionWeight(session)),
    capacityMax: deriveStats(session.character).capacity,
    jewelry: jewelryHud(session.character),
    summons: (session.summons ?? []).map((summon) => ({
      uid: summon.uid,
      name: summon.name,
      ticksLeft: summon.ticksLeft,
      lookType: summon.lookType,
      familiar: summon.familiar,
    })),
    loot: Object.entries(session.totals.lootByItem).map(([itemId, count]) => ({
      itemId: Number(itemId),
      name: itemsById.get(Number(itemId))?.name ?? 'item',
      count,
    })),
    active: session.active.map((monster) => ({
      uid: monster.uid,
      monsterId: monster.monsterId,
      health: monster.health,
      maxHealth: monster.maxHealth,
      tileX: monster.tileX,
      tileY: monster.tileY,
      paralyzed: (monster.paralyzeTicks ?? 0) > 0,
    })),
  };
}

export function hourlyRates(session: HuntSession): {
  xpPerHour: number;
  lootPerHour: number;
  suppliesPerHour: number;
  profitPerHour: number;
  killsPerHour: number;
  damagePerHour: number;
} {
  const { totals } = session;
  const scale = totals.ticks > 0 ? TICKS_PER_HOUR / totals.ticks : 0;
  return {
    xpPerHour: Math.round(totals.experience * scale),
    lootPerHour: Math.round(totals.lootValue * scale),
    suppliesPerHour: Math.round(totals.supplyValue * scale),
    profitPerHour: Math.round((totals.lootValue - totals.supplyValue) * scale),
    killsPerHour: Math.round(totals.kills * scale),
    damagePerHour: Math.round(totals.damageDealt * scale),
  };
}
