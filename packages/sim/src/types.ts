import type { CombatType, SkillName } from '@tibia-idle/data';

/** Wall-clock milliseconds per simulation tick. Fixed: changing it changes every seed. */
export const TICK_MS = 250;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const TICKS_PER_HOUR = (60 * 60 * 1000) / TICK_MS;

export type EquipSlot =
  | 'head' | 'necklace' | 'backpack' | 'armor' | 'right' | 'left'
  | 'legs' | 'feet' | 'ring' | 'ammo';

export interface SkillState {
  level: number;
  tries: number;
}

/** What the character carries into a hunt and burns through while there. */
export interface SupplyStack {
  itemId: number;
  count: number;
}

/** Player-configured automation. This is the real gameplay lever in an idle game. */
export interface HuntPolicy {
  /** Drink a health potion below this fraction of max HP. */
  healthPotionAt: number;
  /** Drink a mana potion below this fraction of max mana. */
  manaPotionAt: number;
  /** Leave the hunt below this fraction of max HP. */
  fleeAt: number;
  /** Stop when supplies run out rather than fighting on unequipped. */
  stopWhenOutOfSupplies: boolean;
  /** Preferred spell ids, first match that is ready wins. Empty = best DPS. */
  spellPriority: string[];
  /** Spell ids the character will not cast. */
  disabledSpells: string[];
  /** Auto-sell loot worth less than this per item. 0 keeps everything. */
  lootMinValue: number;
  /** Remaining pouch items go to the warehouse when the hunt ends. */
  lootToWarehouse: boolean;
  /** Preferred health potion item id. 0 = strongest allowed. */
  healthPotionId: number;
  /** Preferred mana potion item id. 0 = strongest allowed. */
  manaPotionId: number;
  /** Healing spell id. Empty = none. */
  healSpellId: string;
  /** Cast the healing spell below this fraction of max HP. */
  healSpellAt: number;
  /** utamo vita: convert incoming damage to mana while HP is low. */
  magicShield: boolean;
  magicShieldAt: number;
  /** Swing the weapon. Spells still fire if enabled. */
  autoAttack: boolean;
  /** Challenge extra monsters into the pack. */
  taunt: boolean;
  /** Recast utani hur / utani gran hur. Kiting cuts ranged exposure. */
  haste: boolean;
  /** Eat food from the supply pouch for extra regeneration. */
  food: boolean;
  /** Recast exana * to clear poison/burning and the other combat conditions. */
  cure: boolean;
  /** Attack rune item id. 0 = strongest allowed, -1 = off. */
  runeId: number;
  /** Support rune item id (animate dead). 0 = auto, -1 = off. */
  supportRuneId: number;
  /** Soul attack rune item id (soulfire). 0 = auto, -1 = off. */
  soulRuneId: number;
  /** Monk: keep Virtue of Harmony up (utori virtu). */
  virtueHarmony: boolean;
  /** Monk: cast Focus Harmony (utevo nia) when stacks are low. */
  focusHarmony: boolean;
  /** Summon vocation familiar at lvl 200 (utevo gran res *). */
  familiar: boolean;
  /** Knight: utito tempo (+30% melee, +15% damage taken). */
  bloodRage: boolean;
  /** Knight: utamo tempo (+30% shield, −15% dealt/received). */
  protector: boolean;
  /** Paladin: utori con (+40% distance). */
  sharpshooter: boolean;
  /** Spirit potion item id. 0 = auto, -1 = off. Paladin/monk only. */
  spiritPotionId: number;
}

export const DEFAULT_POLICY: HuntPolicy = {
  healthPotionAt: 0.6,
  manaPotionAt: 0.4,
  fleeAt: 0.15,
  stopWhenOutOfSupplies: true,
  spellPriority: [],
  disabledSpells: [],
  lootMinValue: 0,
  lootToWarehouse: false,
  healthPotionId: 0,
  manaPotionId: 0,
  healSpellId: '',
  healSpellAt: 0.7,
  magicShield: false,
  magicShieldAt: 0.4,
  autoAttack: true,
  taunt: false,
  haste: true,
  food: true,
  cure: true,
  runeId: -1,
  supportRuneId: -1,
  soulRuneId: -1,
  virtueHarmony: true,
  focusHarmony: true,
  familiar: true,
  bloodRage: false,
  protector: false,
  sharpshooter: false,
  spiritPotionId: -1,
};

export type HelperMode = 'hunt' | 'boss' | 'pvp';

export function clonePolicy(policy: HuntPolicy): HuntPolicy {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    spellPriority: [...(policy.spellPriority ?? [])],
    disabledSpells: [...(policy.disabledSpells ?? [])],
  };
}

export function normalizePolicy(policy: HuntPolicy): HuntPolicy {
  policy.spellPriority ??= [];
  policy.disabledSpells ??= [];
  policy.lootMinValue ??= 0;
  policy.healthPotionId ??= 0;
  policy.manaPotionId ??= 0;
  policy.healSpellId ??= '';
  policy.healSpellAt ??= 0.7;
  policy.magicShield ??= false;
  policy.magicShieldAt ??= 0.4;
  policy.autoAttack ??= true;
  policy.taunt ??= false;
  policy.lootToWarehouse ??= false;
  policy.haste ??= true;
  policy.food ??= true;
  policy.cure ??= true;
  policy.runeId ??= -1;
  policy.supportRuneId ??= -1;
  policy.soulRuneId ??= -1;
  policy.virtueHarmony ??= true;
  policy.focusHarmony ??= true;
  policy.familiar ??= true;
  policy.bloodRage ??= false;
  policy.protector ??= false;
  policy.sharpshooter ??= false;
  policy.spiritPotionId ??= -1;
  return policy;
}

/** Hunt is the live policy. Boss/PvP start as copies until the player edits them. */
export function policyForMode(character: CharacterState, mode: HelperMode): HuntPolicy {
  if (mode === 'hunt') return character.policy;
  return character.helperProfiles?.[mode] ?? character.policy;
}

export function policyForWave(character: CharacterState, waveIndex: number): HuntPolicy {
  return waveIndex === 9 ? policyForMode(character, 'boss') : character.policy;
}

export interface CharacterState {
  name: string;
  vocationId: number;
  active?: boolean;
  level: number;
  experience: number;
  skills: Record<SkillName, SkillState>;
  magicLevel: number;
  manaSpent: number;
  health: number;
  mana: number;
  /** Equipped item ids by slot. */
  equipment: Partial<Record<EquipSlot, number>>;
  /** Minutes remaining, 0-2520 (42 hours). */
  stamina: number;
  /** Continuous resting delay and unspent regeneration time, preserved between polls. */
  staminaRestMs?: number;
  staminaRegenCreditMs?: number;
  premium: boolean;
  gold: number;
  /** Bitmask of PvE blessings (Crystal ids 2/4/8/16/32). */
  blessings: number;
  /** 1 = bitmask storage; missing/0 = legacy count migrated on load. */
  blessingsVersion?: number;
  /** Soul points. Regenerates on the vocation's gainSoulTicks while hunting. */
  soul: number;
  /** Monk Harmony stacks 0–5. */
  harmony: number;
  /** Virtue of Harmony active — floor of 1 stack and +3% base spender bonus. */
  virtueHarmony: boolean;
  supplies: SupplyStack[];
  policy: HuntPolicy;
  /** Helper Hunt is `policy`. Boss and PvP are stored here once edited. */
  helperProfiles: Partial<Record<Exclude<HelperMode, 'hunt'>, HuntPolicy>>;
  /** Lifetime kills by monster id. Drives bestiary unlocks and charm points. */
  bestiary: Record<string, number>;
  coins: number;
  vipUntil: number;
  gender: 'm' | 'f';
  startWeapon: 'axe' | 'sword' | 'club';
  warehouse: WarehouseStack[];
  /** Items stored inside the worn backpack (distinct stack slots). */
  backpackContents: WarehouseStack[];
  charmsUnlocked: number[];
  charmBinds: CharmBind[];
  prey: PreySlot[];
  /** Prey Wildcards (Store / daily). Legacy field `preyRerolls` mirrors this. */
  preyWildcards?: number;
  preyRerolls: number;
  imbuements: ImbueSlot[];
  /** Species influence (XP/loot vs that creature), 0–100. Not exaltation dust. */
  forge: Record<string, number>;
  /** Exaltation Forge dust currency. */
  forgeDust: number;
  /** Soft cap on forgeDust (Crystal default 100, max 225). */
  forgeDustLevel: number;
  /** Crystal forge slivers. */
  forgeSlivers: number;
  /** Crystal exalted cores. */
  forgeCores: number;
  dailyClaim: string;
  dailyStreak: number;
  /** Wall-clock expiry for the daily +10% XP boost. */
  xpBoostUntil: number;
  /** Store-bought timed boosts (Tibia Coins). */
  storeXpBoostUntil: number;
  storeXpBoostBonus: number;
  storeLootBoostUntil: number;
  storeLootBoostBonus: number;
  storeGoldBoostUntil: number;
  storeGoldBoostBonus: number;
  /** Purchased cosmetic ids — equipping does not consume them. */
  unlockedOutfits: number[];
  unlockedMounts: number[];
  appearance: Appearance;
  partySlots: number;
  guildId: number | null;
  decorations: string[];
  /** Tries granted the last time the exercise dummy ran (idle only). */
  lastDummyTries: number;
  arenaWins: number;
  arenaLosses: number;
  /** 0 = first session, 99 = finished. */
  onboardingStep: number;
  /** Wheel of Destiny ranks by node id. */
  wheel: Record<string, number>;
  /** Lifetime boss kills by monster id. */
  bosstiary: Record<string, number>;
  /** Assigned bosses that grant extra loot/XP when killed. */
  bossSlots: string[];
  /** Boss lever cooldowns: encounter id → unix ms when fight is allowed again. */
  bossCooldowns?: Record<string, number>;
  /** Forge refinement per slot, 0-10. Missing slots infer from level. */
  equipmentTiers: Partial<Record<EquipSlot, number>>;
  /** Remaining charges on worn jewellery (SSA, might ring). */
  equipmentCharges: Partial<Record<EquipSlot, number>>;
  /** Remaining duration ticks on worn rings. */
  equipmentDuration: Partial<Record<EquipSlot, number>>;
  /** Charges/duration preserved when a piece is unequipped into the warehouse. */
  jewelryRemaining: Record<number, { charges?: number; ticks?: number }>;
  /** Visible loot pouch capacity. Starts at 8. */
  lootSlots: number;
  /** Distinct stack slots in the supply pouch (potions, runes, ammo). */
  supplySlots: number;
  /** Saved outfit/mount/aura looks. */
  appearancePresets: Appearance[];
  /** Active Killing-in-the-Name-of style hunt task. */
  task: HuntingTask | null;
  /** Last cave entered, used to roll a new task. */
  lastHuntId: string | null;
}

export interface HuntingTask {
  monsterId: string;
  required: number;
  progress: number;
  gold: number;
  experience: number;
  claimed: boolean;
}

export type PreyBonus = 'damage' | 'defense' | 'experience' | 'loot';

export interface PreySlot {
  monsterId: string | null;
  /** Nine monsters offered before activation (Tibia list reroll). */
  candidates: string[];
  bonus: PreyBonus;
  /** 0–9 star index into preyBonuses tables (UI shows star+1). */
  star: number;
  /** Lock Prey — auto-renew with 5 wildcards when timer ends. */
  locked: boolean;
  /** Automatic Bonus Reroll — 1 wildcard to reroll bonus when timer ends. */
  autoBonusReroll: boolean;
  /** Next free list reroll (20h per slot). */
  listRerollAt: number;
  expiresAt: number;
}

export interface CharmBind {
  charmId: number;
  monsterId: string;
}

export interface ImbueSlot {
  slot: EquipSlot;
  /** Crystal per-item shrine index (0 .. imbuementSlots-1). */
  index?: number;
  type: string;
  tier: number;
  expiresAt: number;
}

export interface WarehouseStack {
  itemId: number;
  count: number;
}

export interface Appearance {
  outfit: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  aura: number;
  mount: number;
  /** Outfit addon pattern index: 0 base, 1 first, 2 second, 3 both. */
  addons: number;
}

/** Stats derived from level, vocation, skills and gear. Recomputed, never stored. */
export interface DerivedStats {
  maxHealth: number;
  maxMana: number;
  capacity: number;
  attackValue: number;
  attackSkill: number;
  attackSkillName: SkillName;
  isMelee: boolean;
  isMagic: boolean;
  defense: number;
  armor: number;
  mitigation: number;
  /** Milliseconds between attacks. */
  attackSpeed: number;
  healthRegenPerTick: number;
  manaRegenPerTick: number;
}

export interface ActiveMonster {
  /** Unique within the session, so the client can track sprites. */
  uid: number;
  monsterId: string;
  health: number;
  maxHealth: number;
  /** Stand SQM for AoE ammo / client sync (Crystal combat area is tile-based). */
  tileX: number;
  tileY: number;
  /** Ticks until each attack index is ready. */
  attackCooldowns: number[];
  healCooldown: number;
  /** Soulfire-style damage over time on this target. */
  dot?: {
    damage: number;
    ticksLeft: number;
    intervalTicks: number;
    nextTick: number;
    damageType: import('@tibia-idle/data').CombatType;
  };
  /** Remaining ticks of charm paralysis (Cripple / Numb). */
  paralyzeTicks?: number;
  /** Fatal Hold: remaining ticks where runOnHealth flee is blocked. */
  holdTicks?: number;
}

export interface HuntSummon {
  uid: number;
  name: string;
  minDamage: number;
  maxDamage: number;
  ticksLeft: number;
  attackCooldown: number;
  /** Crystal familiar lookType for the viewport. */
  lookType?: number;
  damageType?: CombatType;
  /** True for vocation familiars (not animate-dead skeletons). */
  familiar?: boolean;
}

export type ConditionId = 'poison' | 'burning' | 'electrified' | 'cursed' | 'freezing';

export interface ActiveCondition {
  id: ConditionId;
  damageType: CombatType;
  ticksLeft: number;
  intervalTicks: number;
  nextTick: number;
  damage: number;
}

export type SimEventType =
  | 'player_attack'
  | 'monster_attack'
  | 'monster_death'
  | 'monster_spawn'
  | 'loot'
  | 'level_up'
  | 'skill_up'
  | 'potion'
  | 'heal'
  | 'player_death'
  | 'out_of_supplies'
  | 'fled'
  | 'stamina_depleted'
  | 'combo'
  | 'task_complete'
  | 'condition'
  | 'buff'
  | 'monster_flee'
  | 'forge_dust'
  | 'boss_cleared';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  /** Character that produced the event when it comes from a party member. */
  actorId?: number;
  /** Target or source monster uid where relevant. */
  uid?: number;
  monsterId?: string;
  amount?: number;
  damageType?: CombatType;
  itemId?: number;
  count?: number;
  skill?: string;
  level?: number;
  /** True when the hit was fully absorbed. */
  blocked?: boolean;
  /** Distance shot missed (Crystal hit chance roll). */
  missed?: boolean;
  critical?: boolean;
  fatal?: boolean;
  dodged?: boolean;
  combo?: number;
  leech?: number;
  /** Spell words shown above the caster, e.g. "exori ico". */
  words?: string;
  /** CONST_ANI_* missile that flies from attacker to target. */
  shoot?: string;
  /** CONST_ME_* cast effect (berserk HITAREA, groundshaker, waves, …). */
  effect?: string;
  /** True when the spell hits every engaged creature (area / wave). */
  area?: boolean;
  /** Ammo AoE shape: burst3 | diamond5 | storm5 (Crystal createCombatArea). */
  areaShape?: string;
  /** Impact stand tile for ammo AoE FX (Crystal area centered here). */
  impactX?: number;
  impactY?: number;
  /** Caster facing for directional waves/beams (0=N, 1=E, 2=S, 3=W). */
  areaDirection?: number;
  /** Knight / monk melee swing sprite (sword, axe, club, fist, monk-staff, monk-daggers). */
  attackEffect?: string;
}

/** Running totals that power the Hunt, Loot and Supply analysers. */
export interface SessionTotals {
  ticks: number;
  kills: number;
  experience: number;
  rawExperience: number;
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  lootValue: number;
  supplyValue: number;
  potionsUsed: number;
  deaths: number;
  lootByItem: Record<number, number>;
  suppliesByItem: Record<number, number>;
  crits: number;
  dodges: number;
  fatals: number;
  /** Distance shots that failed the hit-chance roll. */
  misses: number;
  leech: number;
  maxCombo: number;
  /** Times forge Transcendence avatar triggered this hunt. */
  avatars: number;
}

export function emptyTotals(): SessionTotals {
  return {
    ticks: 0,
    kills: 0,
    experience: 0,
    rawExperience: 0,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    lootValue: 0,
    supplyValue: 0,
    potionsUsed: 0,
    deaths: 0,
    lootByItem: {},
    suppliesByItem: {},
    crits: 0,
    dodges: 0,
    fatals: 0,
    misses: 0,
    leech: 0,
    maxCombo: 0,
    avatars: 0,
  };
}

export type SessionStatus = 'active' | 'out_of_supplies' | 'fled' | 'no_stamina' | 'died' | 'stopped' | 'boss_cleared';

/** Other hunters occupying the same cave. Used for party XP and ally sprites. */
export interface PartyHunter {
  id: number;
  name: string;
  level: number;
  vocationId: number;
  appearance?: Appearance;
  experience?: number;
  health?: number;
  maxHealth?: number;
  mana?: number;
  maxMana?: number;
  equipment?: Record<string, { id: number; name: string }>;
  backpackContents?: Array<{ itemId: number; name: string; count: number }>;
  backpackCapacity?: number;
}

/** Remaining spell-group cooldown ticks. Migrates legacy single `spellCooldown`. */
export function normalizeSession(session: HuntSession): void {
  const legacy = (session as { spellCooldown?: number }).spellCooldown;
  if (!session.spellCooldowns) {
    session.spellCooldowns = {};
    if (legacy && legacy > 0) {
      for (const group of ['attack', 'wave', 'special', 'ultimate', 'support'] as const) {
        session.spellCooldowns[group] = legacy;
      }
    }
  }
  delete (session as { spellCooldown?: number }).spellCooldown;
}

export interface HuntSession {
  huntId: string;
  /** Ticks elapsed since the session started. */
  tick: number;
  rngState: [number, number, number, number];
  character: CharacterState;
  active: ActiveMonster[];
  nextUid: number;
  playerAttackCooldown: number;
  /** Remaining ticks per spell group (attack / wave / special / ultimate). */
  spellCooldowns: Partial<Record<import('./spells.js').SpellGroup, number>>;
  /** Wall-clock ms when the hunt started; drives imbuement expiry mid-session. */
  startedAt?: number;
  regenCounterHealth: number;
  regenCounterMana: number;
  /** Fractional spawn budget carried between ticks. See src/throughput.ts. */
  spawnCredits: number;
  /** Wave 1 is pre-placed; subtract from the first respawn threshold only. */
  initialPackCredit?: number;
  /** Next pack is due immediately after the last kill in the wave. */
  spawnNextWave?: boolean;
  totals: SessionTotals;
  status: SessionStatus;
  combo: number;
  comboTick: number;
  /** Live cave-mates, refreshed on each load. Not a purchased slot list. */
  partyMembers?: PartyHunter[];
  /** Remaining ticks of utani hur / utani gran hur. */
  hasteTicks: number;
  /** Remaining ticks of the last eaten food. */
  foodTicks: number;
  /** Remaining ticks of utamo vita. */
  magicShieldTicks: number;
  /** Remaining ticks of monster-applied player paralyze (speed lock). */
  playerParalyzeTicks?: number;
  /** Remaining ticks of forge Transcendence avatar (Crystal AVATAR_FORGE). */
  avatarTicks?: number;
  /** Milliseconds accumulated toward the next soul point. */
  soulAccMs: number;
  conditions: ActiveCondition[];
  /** Frozen at hunt start so calibration sessions without it stay official. */
  boostedMonsterId?: string;
  /** Last death penalty applied this session (for settlement UI). */
  lastDeathPenalty?: import('./blessings.js').DeathPenaltyResult;
  /** Skeletons from animate dead and similar effects. */
  summons?: HuntSummon[];
  /** Remaining ticks before Focus Harmony can be cast again. */
  focusHarmonyCooldown?: number;
  /** Remaining ticks before the vocation familiar can be resummoned. */
  familiarCooldown?: number;
  /** When false, runOnHealth flee is disabled (calibration). */
  creatureFlee?: boolean;
  /** Crystal healing exhaust between potions/spells (~1s). */
  healCooldownTicks?: number;
  /** Active knight/paladin support stances toggled by the Helper. */
  bloodRageActive?: boolean;
  protectorActive?: boolean;
  sharpshooterActive?: boolean;
}

export interface SimRates {
  experience: number;
  skill: number;
  magic: number;
  loot: number;
  /** Applied to how many monsters are engaged at once. */
  monstersPerEngagement: number;
}

export const DEFAULT_RATES: SimRates = {
  experience: 1,
  skill: 1,
  magic: 1,
  loot: 1,
  monstersPerEngagement: 2,
};
