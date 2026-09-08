import { getVocation, itemsById, outfitsCatalog, SKILL_NAMES, type Item, type SkillName, type Vocation } from '@tibia-idle/data';
import {
  expForLevel, levelGains, maxWeaponDamage, minWeaponDamage,
  playerDefense, playerMitigation, reqMana, reqSkillTries, ATTACK_FACTOR,
} from './formulas.js';
import { migrateBlessings } from './blessings.js';
import { DEFAULT_POLICY, TICK_MS, normalizePolicy, type CharacterState, type DerivedStats, type EquipSlot } from './types.js';
import { defaultAppearance, emptyPreySlot, ensurePreySlots, LOOT_SLOT_DEFAULT, SUPPLY_SLOT_DEFAULT, outfitMatchesGender } from './progression.js';
import { DEFAULT_BACKPACK_ID } from './gear.js';
import { ensureBackpackEquipped } from './inventory.js';
import { wheelBonus } from './endgame.js';
import { itemBonus, skillBonusKey } from './procs.js';
import { jewelrySkillBonus, jewelrySpec, bindJewelry } from './jewelry.js';
import { imbueCapacityPercent, imbueSkillBonus } from './imbuements.js';
import { consumeExerciseHits, triesPerExerciseCharge } from './exercise.js';

/** Vocation groups that decide how a character deals damage. */
const MELEE_VOCATIONS = new Set([4, 8]);
const MONK_VOCATIONS = new Set([9, 10]);
const DISTANCE_VOCATIONS = new Set([3, 7]);
const MAGIC_VOCATIONS = new Set([1, 2, 5, 6]);

/** `weaponType` values as they appear in items.xml. */
const WEAPON_SKILL: Record<string, SkillName> = {
  sword: 'sword',
  axe: 'axe',
  club: 'club',
  distance: 'distance',
  ammo: 'distance',
  ammunition: 'distance',
  missile: 'distance',
  fist: 'fist',
};

export function isMagicVocation(vocationId: number): boolean {
  return MAGIC_VOCATIONS.has(vocationId);
}

export function isDistanceVocation(vocationId: number): boolean {
  return DISTANCE_VOCATIONS.has(vocationId);
}

function equipped(character: CharacterState, slot: EquipSlot): Item | null {
  const id = character.equipment[slot];
  return id === undefined ? null : itemsById.get(id) ?? null;
}

export function skillLevel(character: CharacterState, skill: SkillName): number {
  return (character.skills[skill]?.level ?? 10)
    + itemBonus(character, skillBonusKey(skill))
    + jewelrySkillBonus(character, skill)
    + imbueSkillBonus(character, skill);
}

/**
 * Everything the combat loop needs, computed from level, vocation and gear.
 *
 * Derived state is never persisted: storing it would let it drift out of sync
 * with the character it came from.
 */
export function deriveStats(character: CharacterState): DerivedStats {
  const vocation = getVocation(character.vocationId);
  const gains = levelGains(vocation);
  const levelsGained = Math.max(0, character.level - 1);

  // Starting values for a level 1 character, before vocation gains.
  const wheel = wheelBonus(character);
  const maxHealth = Math.round((150 + levelsGained * gains.hp) * (1 + wheel.health));
  const maxMana = Math.round((55 + levelsGained * gains.mana) * (1 + wheel.mana));
  const baseCapacity = 40000 + levelsGained * gains.cap;
  const capacity = Math.floor(baseCapacity * (1 + imbueCapacityPercent(character) / 100));

  const weapon = equipped(character, 'left') ?? equipped(character, 'right');
  const shield = equipped(character, 'right');
  const ammo = equipped(character, 'ammo');

  const isMagic = MAGIC_VOCATIONS.has(vocation.id);
  const isDistance = DISTANCE_VOCATIONS.has(vocation.id);
  const isMonk = MONK_VOCATIONS.has(vocation.id);
  const isMelee = MELEE_VOCATIONS.has(vocation.id) || isMonk;

  let attackSkillName: SkillName = isMonk ? 'fist' : isDistance ? 'distance' : 'sword';
  if (weapon?.weaponType && WEAPON_SKILL[weapon.weaponType]) {
    attackSkillName = WEAPON_SKILL[weapon.weaponType] as SkillName;
  }

  // Crystal WeaponDistance: ammo attack (+ element handled in ammo.ts) + bow attack.
  // Fist fallback is 7 when nothing is equipped (Weapon::useFist).
  const bowAttack = isDistance && weapon
    && (weapon.weaponType === 'distance' || /\b(bow|crossbow)\b/i.test(weapon.name))
    ? weapon.attack
    : 0;
  const attackValue = isDistance && ammo
    ? ammo.attack + bowAttack
    : weapon?.attack ?? (isMelee || isMonk ? 7 : 0);

  const hasShield = shield?.weaponType === 'shield' || shield?.weaponType === 'spellbook';
  const isSpellbook = shield?.weaponType === 'spellbook';

  const defense = playerDefense(
    skillLevel(character, 'shield'),
    shield?.defense ?? 0,
    weapon?.defense ?? 0,
    vocation,
    { hasShield, isSpellbook },
  );

  let armor = 0;
  for (const slot of ['head', 'armor', 'legs', 'feet', 'ring', 'necklace'] as EquipSlot[]) {
    armor += equipped(character, slot)?.armor ?? 0;
  }
  armor = Math.floor(armor * vocation.armor);

  const mitigation = playerMitigation(
    skillLevel(character, 'shield'),
    (shield?.defense ?? 0) + (weapon?.defense ?? 0),
    vocation,
    hasShield,
  );

  return {
    maxHealth,
    maxMana,
    capacity,
    attackValue,
    attackSkill: skillLevel(character, attackSkillName),
    attackSkillName,
    isMelee,
    isMagic,
    defense,
    armor,
    mitigation,
    attackSpeed: vocation.attackSpeed,
    healthRegenPerTick: regenPerTick(vocation.gainHpAmount, vocation.gainHpTicks),
    manaRegenPerTick: regenPerTick(vocation.gainManaAmount, vocation.gainManaTicks),
  };
}

/** The engine regenerates `amount` every `intervalMs`; spread that over our ticks. */
function regenPerTick(amount: number, intervalMs: number): number {
  if (intervalMs <= 0) return 0;
  return (amount * TICK_MS) / intervalMs;
}

/** Physical damage range for a weapon attack, before the target's defenses. */
export function weaponDamageRange(character: CharacterState, stats: DerivedStats): { min: number; max: number } {
  const max = maxWeaponDamage(
    character.level,
    stats.attackSkill,
    stats.attackValue,
    ATTACK_FACTOR,
    stats.isMelee,
  );
  return { min: Math.min(minWeaponDamage(character.level, stats.attackValue), max), max };
}

export interface LevelUpResult {
  levels: number;
  newLevel: number;
}

/** Add experience and apply any resulting level ups. */
export function addExperience(character: CharacterState, amount: number): LevelUpResult {
  character.experience += amount;
  const before = character.level;
  while (character.experience >= expForLevel(character.level + 1)) {
    character.level += 1;
  }
  const levels = character.level - before;
  if (levels > 0) {
    // Levelling restores the newly gained pool, matching the engine.
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = stats.maxMana;
  }
  return { levels, newLevel: character.level };
}

/** Credit skill tries, returning how many skill levels were gained. */
export function addSkillTries(
  character: CharacterState,
  skill: SkillName,
  tries: number,
  rate: number,
): number {
  const vocation = getVocation(character.vocationId);
  const state = character.skills[skill];
  if (!state) return 0;
  const index = SKILL_NAMES.indexOf(skill);
  const multiplier = vocation.skillMultipliers[skill];

  state.tries += tries * rate;
  let gained = 0;
  for (;;) {
    const needed = reqSkillTries(index, state.level + 1, multiplier);
    if (needed <= 0 || state.tries < needed) break;
    state.tries -= needed;
    state.level += 1;
    gained += 1;
  }
  return gained;
}

/** Percent of the way to the next skill level, 0–100. */
export function skillProgressPercent(
  vocationId: number,
  skill: SkillName,
  level: number,
  tries: number,
): number {
  const vocation = getVocation(vocationId);
  const index = SKILL_NAMES.indexOf(skill);
  const needed = reqSkillTries(index, level + 1, vocation.skillMultipliers[skill]);
  if (needed <= 0) return 0;
  return Math.max(0, Math.min(100, (tries / needed) * 100));
}

/** Percent of the way to the next magic level, 0–100. */
export function magicProgressPercent(vocationId: number, magicLevel: number, manaSpent: number): number {
  const vocation = getVocation(vocationId);
  const needed = reqMana(magicLevel + 1, vocation.manaMultiplier);
  if (needed <= 0) return 0;
  return Math.max(0, Math.min(100, (manaSpent / needed) * 100));
}

/** Credit spent mana toward magic level, returning levels gained. */
export function addManaSpent(character: CharacterState, mana: number, rate: number): number {
  const vocation = getVocation(character.vocationId);
  character.manaSpent += mana * rate;
  let gained = 0;
  for (;;) {
    const needed = reqMana(character.magicLevel + 1, vocation.manaMultiplier);
    if (needed <= 0 || character.manaSpent < needed) break;
    character.manaSpent -= needed;
    character.magicLevel += 1;
    gained += 1;
  }
  return gained;
}

/**
 * Exercise dummy while the character is not hunting.
 *
 * Tibia beds train ~1 try / 2s; idle is slower (1 / 8s) with an 8h cap so a
 * night away still moves the skill bar without replacing a real hunt.
 */
export function dummySkillName(character: CharacterState): SkillName | 'magic' {
  if (isMagicVocation(character.vocationId)) return 'magic';
  if (isDistanceVocation(character.vocationId)) return 'distance';
  if (character.vocationId === 9 || character.vocationId === 10) return 'fist';
  return character.startWeapon;
}

export function trainOffline(character: CharacterState, idleMs: number): number {
  const capped = Math.min(Math.max(0, idleMs), 8 * 60 * 60 * 1000);
  const hits = Math.floor(capped / 8_000);
  if (hits <= 0) return 0;

  const skill = dummySkillName(character);
  const used = consumeExerciseHits(character, skill, hits);
  if (used > 0) {
    const perCharge = triesPerExerciseCharge(skill);
    const gained = used * perCharge;
    if (skill === 'magic') {
      addManaSpent(character, gained, 1);
    } else {
      addSkillTries(character, skill, gained, 1);
    }
    character.lastDummyTries = gained;
    return gained;
  }

  const tries = hits;
  if (skill === 'magic') {
    addManaSpent(character, tries * 20, 1);
    character.lastDummyTries = tries;
    return tries;
  }
  addSkillTries(character, skill, tries, 1);
  character.lastDummyTries = tries;
  return tries;
}

/** A fresh level 8 character, matching what the server hands a new player. */
export function createCharacter(name: string, vocationId: number): CharacterState {
  const vocation: Vocation = getVocation(vocationId);
  const skills = Object.fromEntries(
    SKILL_NAMES.map((skill) => [skill, { level: 10, tries: 0 }]),
  ) as Record<SkillName, { level: number; tries: number }>;

  const character: CharacterState = {
    name,
    vocationId: vocation.id,
    level: 8,
    experience: expForLevel(8),
    skills,
    magicLevel: 0,
    manaSpent: 0,
    health: 1,
    mana: 1,
    equipment: {},
    stamina: 2520,
    premium: false,
    gold: 0,
    blessings: 0,
    blessingsVersion: 1,
    soul: 0,
    harmony: 0,
    virtueHarmony: false,
    supplies: [],
    policy: { ...DEFAULT_POLICY },
    helperProfiles: {},
    bestiary: {},
    coins: 10_000,
    vipUntil: 0,
    gender: 'm',
    startWeapon: 'sword',
    warehouse: [],
    backpackContents: [],
    charmsUnlocked: [],
    charmBinds: [],
    prey: [emptyPreySlot(), emptyPreySlot(), emptyPreySlot()],
    preyWildcards: 3,
    preyRerolls: 3,
    imbuements: [],
    forge: {},
    forgeDust: 0,
    forgeDustLevel: 100,
    forgeSlivers: 0,
    forgeCores: 0,
    dailyClaim: '',
    dailyStreak: 0,
    xpBoostUntil: 0,
    storeXpBoostUntil: 0,
    storeXpBoostBonus: 0,
    storeLootBoostUntil: 0,
    storeLootBoostBonus: 0,
    storeGoldBoostUntil: 0,
    storeGoldBoostBonus: 0,
    appearance: defaultAppearance(vocation.id),
    unlockedOutfits: [defaultAppearance(vocation.id).outfit],
    unlockedMounts: [],
    partySlots: 1,
    guildId: null,
    decorations: [],
    lastDummyTries: 0,
    arenaWins: 0,
    arenaLosses: 0,
    onboardingStep: 0,
    wheel: {},
    bosstiary: {},
    bossSlots: [],
    bossCooldowns: {},
    equipmentTiers: {},
    equipmentCharges: {},
    equipmentDuration: {},
    jewelryRemaining: {},
    lootSlots: LOOT_SLOT_DEFAULT,
    supplySlots: SUPPLY_SLOT_DEFAULT,
    appearancePresets: [],
    task: null,
    lastHuntId: null,
  };

  if (vocation.id === 4 || vocation.id === 8) {
    character.policy.healSpellId = 'wound_cleansing';
    character.equipment.left = 3264; // sword
  } else if (vocation.id === 2 || vocation.id === 6) {
    character.policy.healSpellId = 'light_healing';
    character.equipment.left = 3066;
  } else if (vocation.id === 1 || vocation.id === 5) {
    character.equipment.left = 3074;
  } else if (vocation.id === 3 || vocation.id === 7) {
    character.policy.healSpellId = 'light_healing';
  } else if (vocation.id === 9 || vocation.id === 10) {
    character.equipment.left = 50166; // light jo staff
  }

  character.equipment.backpack = DEFAULT_BACKPACK_ID;

  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  return character;
}

/** Drop imbuements whose 20-hour window has passed. */
export function pruneExpiredImbuements(character: CharacterState, now = Date.now()): void {
  if (!character.imbuements?.length) return;
  character.imbuements = character.imbuements.filter((entry) => entry.expiresAt > now);
}

/** Fill fields added after a character was first saved. */
export function normalizeCharacter(character: CharacterState): CharacterState {
  character.bestiary ??= {};
  character.supplies ??= [];
  character.policy ??= { ...DEFAULT_POLICY };
  character.helperProfiles ??= {};
  character.equipment ??= {};
  character.coins ??= 10_000;
  character.vipUntil ??= 0;
  character.gender ??= 'm';
  character.startWeapon ??= 'sword';
  character.warehouse ??= [];
  character.backpackContents ??= [];
  character.charmsUnlocked ??= [];
  character.charmBinds ??= [];
  character.prey ??= [emptyPreySlot(), emptyPreySlot(), emptyPreySlot()];
  character.preyWildcards ??= character.preyRerolls ?? 0;
  character.preyRerolls ??= character.preyWildcards ?? 0;
  ensurePreySlots(character);
  character.imbuements ??= [];
  character.forge ??= {};
  character.forgeDust ??= 0;
  character.forgeDustLevel ??= 100;
  character.forgeSlivers ??= 0;
  character.forgeCores ??= 0;
  character.dailyClaim ??= '';
  character.dailyStreak ??= 0;
  character.xpBoostUntil ??= 0;
  character.storeXpBoostUntil ??= 0;
  character.storeXpBoostBonus ??= 0;
  character.storeLootBoostUntil ??= 0;
  character.storeLootBoostBonus ??= 0;
  character.storeGoldBoostUntil ??= 0;
  character.storeGoldBoostBonus ??= 0;
  character.appearance ??= defaultAppearance(character.vocationId);
  character.appearance.aura ??= 0;
  character.appearance.mount ??= 0;
  character.appearance.addons ??= 0;
  character.unlockedOutfits ??= [character.appearance.outfit];
  if (!character.unlockedOutfits.includes(character.appearance.outfit)) {
    character.unlockedOutfits.push(character.appearance.outfit);
  }
  for (const entry of outfitsCatalog) {
    if (entry.unlocked !== true && entry.from !== 'default') continue;
    for (const look of [entry.male, entry.female, entry.outfit]) {
      if (look != null && !character.unlockedOutfits.includes(look)) {
        character.unlockedOutfits.push(look);
      }
    }
  }
  // If an old save equipped the wrong sex look, snap to this gender's free default.
  const gender = character.gender ?? 'm';
  if (!outfitMatchesGender(character.appearance.outfit, gender)) {
    const fallback = outfitsCatalog.find((entry) => {
      if (entry.unlocked !== true && entry.from !== 'default') return false;
      return (gender === 'f' ? entry.female : entry.male) != null;
    });
    const next = fallback
      ? (gender === 'f' ? fallback.female : fallback.male)
      : defaultAppearance(character.vocationId).outfit;
    if (next != null) character.appearance.outfit = next;
  }
  character.unlockedMounts ??= [];
  character.partySlots ??= 1;
  character.guildId ??= null;
  character.decorations ??= [];
  character.lastDummyTries ??= 0;
  character.arenaWins ??= 0;
  character.arenaLosses ??= 0;
  character.onboardingStep ??= 99;
  character.wheel ??= {};
  character.bosstiary ??= {};
  character.bossSlots ??= [];
  character.bossCooldowns ??= {};
  character.equipmentTiers ??= {};
  character.equipmentCharges ??= {};
  character.equipmentDuration ??= {};
  character.jewelryRemaining ??= {};
  for (const slot of ['ring', 'necklace'] as const) {
    const itemId = character.equipment[slot];
    if (!itemId) continue;
    const spec = jewelrySpec(itemId);
    if (!spec) continue;
    if (spec.kind === 'charges' && character.equipmentCharges[slot] === undefined) bindJewelry(character, slot, itemId);
    if (spec.kind === 'duration' && character.equipmentDuration[slot] === undefined) bindJewelry(character, slot, itemId);
  }
  character.lootSlots = Math.max(character.lootSlots ?? 0, LOOT_SLOT_DEFAULT);
  character.supplySlots = Math.max(character.supplySlots ?? 0, SUPPLY_SLOT_DEFAULT);
  character.appearancePresets ??= [];
  character.task ??= null;
  character.lastHuntId ??= null;
  character.blessings ??= 0;
  migrateBlessings(character);
  character.soul ??= 0;
  character.harmony ??= 0;
  character.virtueHarmony ??= false;
  normalizePolicy(character.policy);
  for (const mode of ['boss', 'pvp'] as const) {
    const profile = character.helperProfiles[mode];
    if (profile) normalizePolicy(profile);
  }
  if (character.vipUntil > 0 && character.vipUntil < Date.now()) {
    character.premium = false;
  }
  if ((character.xpBoostUntil ?? 0) > 0 && character.xpBoostUntil < Date.now()) {
    character.xpBoostUntil = 0;
  }
  const now = Date.now();
  if ((character.storeXpBoostUntil ?? 0) > 0 && character.storeXpBoostUntil < now) {
    character.storeXpBoostUntil = 0;
    character.storeXpBoostBonus = 0;
  }
  if ((character.storeLootBoostUntil ?? 0) > 0 && character.storeLootBoostUntil < now) {
    character.storeLootBoostUntil = 0;
    character.storeLootBoostBonus = 0;
  }
  if ((character.storeGoldBoostUntil ?? 0) > 0 && character.storeGoldBoostUntil < now) {
    character.storeGoldBoostUntil = 0;
    character.storeGoldBoostBonus = 0;
  }
  pruneExpiredImbuements(character);
  ensureBackpackEquipped(character);
  return character;
}
