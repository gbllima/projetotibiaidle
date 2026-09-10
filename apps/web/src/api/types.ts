import type { HuntSession, SimEvent } from '@tibia-idle/sim';

/** Shapes the server sends. Mirrors apps/server/src/game.ts. */

export interface AccountView {
  admin?: boolean;
  username: string;
  guest: boolean;
  slots: number;
  used: number;
}

export interface EquippedItem {
  id: number;
  name: string;
}

export interface SupplyView {
  itemId: number;
  name: string;
  count: number;
}

export interface LootView {
  itemId: number;
  name: string;
  count: number;
}

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
  crits?: number;
  dodges?: number;
  fatals?: number;
  misses?: number;
  leech?: number;
  maxCombo?: number;
  lootByItem?: Record<number, number>;
  suppliesByItem?: Record<number, number>;
}

export interface HourlyRates {
  xpPerHour: number;
  lootPerHour: number;
  suppliesPerHour: number;
  profitPerHour: number;
  killsPerHour: number;
  damagePerHour: number;
}

export interface ActiveMonsterView {
  uid: number;
  monsterId: string;
  health: number;
  maxHealth: number;
  tileX?: number;
  tileY?: number;
  paralyzed?: boolean;
}

export type SessionStatus = 'active' | 'died' | 'out_of_supplies' | 'fled' | 'no_stamina' | 'stopped' | 'boss_cleared';

export interface SessionView {
  huntId: string;
  status: SessionStatus;
  tick: number;
  elapsedSeconds: number;
  hours: number;
  totals: SessionTotals;
  rates: HourlyRates;
  wave: number;
  wavesTotal: number;
  wavesCleared: number;
  bossWave: boolean;
  packSize: number;
  packAlive?: number;
  packKilled?: number;
  haste?: boolean;
  fed?: boolean;
  utamo?: boolean;
  paralyzed?: boolean;
  avatar?: boolean;
  soul?: number;
  soulMax?: number;
  harmony?: number;
  virtueHarmony?: boolean;
  spellCooldowns?: Partial<Record<'attack' | 'wave' | 'special' | 'ultimate' | 'support', number>>;
  boosted?: string;
  conditions?: string[];
  capacityUsed?: number;
  capacityMax?: number;
  jewelry?: { ring?: string; necklace?: string; ringLeft?: number; necklaceLeft?: number };
  summons?: Array<{ uid: number; name: string; ticksLeft: number; lookType?: number; familiar?: boolean }>;
  loot: LootView[];
  active: ActiveMonsterView[];
}

export interface CharacterView {
  id: number;
  name: string;
  vocation: { id: number; name: string };
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  magicLevel: number;
  manaSpent: number;
  skills: Record<string, { level: number; tries: number }>;
  gold: number;
  /** Whether the character can buy any supply pack for a 1h trip. */
  canAffordTrip?: boolean;
  /** Gold actually spent on a 1h pack right now (may be less than supplyCost). */
  affordableTripCost?: number;
  blessings: number;
  soul: number;
  soulMax: number;
  harmony?: number;
  virtueHarmony?: boolean;
  promoted: boolean;
  task: {
    monsterId: string;
    required: number;
    progress: number;
    gold: number;
    experience: number;
    claimed: boolean;
  } | null;
  stamina: number;
  premium: boolean;
  equipment: Record<string, EquippedItem>;
  supplies: SupplyView[];
  stats: {
    attackValue: number;
    attackSkill: number;
    attackSkillName: string;
    defense: number;
    armor: number;
    mitigation: number;
    capacity: number;
    damagePerSecond: number;
  };
  procs: {
    critChance: number;
    critExtra: number;
    lifeLeech: number;
    manaLeech: number;
    dodgeChance: number;
    onslaughtChance: number;
    momentumChance?: number;
    transcendenceChance?: number;
    amplificationPercent?: number;
    magicLevel: number;
    /** Distance hit chance at adjacent range (paladin only). */
    hitChance?: number;
  };
  session: SessionView | null;
  /** Authoritative hunt snapshot so the browser can predict ticks between pushes. */
  live?: HuntSession | null;
  bestiary: Record<string, number>;
  coins: number;
  vipUntil: number;
  gender: 'm' | 'f';
  warehouse: SupplyView[];
  backpackContents: SupplyView[];
  backpackCapacity: number;
  charmsUnlocked: number[];
  charmBinds: Array<{ charmId: number; monsterId: string }>;
  prey: Array<{
    monsterId: string | null;
    candidates: string[];
    bonus: string;
    star: number;
    locked: boolean;
    autoBonusReroll: boolean;
    listRerollAt: number;
    expiresAt: number;
  }>;
  preyWildcards: number;
  preyRerolls: number;
  imbuements: Array<{ slot: string; index?: number; type: string; tier: number; expiresAt: number }>;
  forge: Record<string, number>;
  forgeDust: number;
  forgeDustLevel: number;
  forgeSlivers: number;
  forgeCores: number;
  dailyClaim: string;
  dailyStreak: number;
  xpBoostUntil: number;
  storeBoosts: {
    xp: { until: number; bonus: number };
    loot: { until: number; bonus: number };
    gold: { until: number; bonus: number };
  };
  unlockedOutfits: number[];
  unlockedMounts: number[];
  appearance: { outfit: number; head: number; body: number; legs: number; feet: number; aura: number; mount: number; addons?: number };
  partySlots: number;
  partyMemberIds?: number[];
  partyBonus: number;
  caveParty: Array<{
    id: number;
    name: string;
    level: number;
    vocationId: number;
    active?: boolean;
    experience?: number;
    health?: number;
    maxHealth?: number;
    mana?: number;
    maxMana?: number;
    equipment?: Record<string, EquippedItem>;
    backpackContents?: SupplyView[];
    backpackCapacity?: number;
    self?: boolean;
    policy?: { autoAttack?: boolean; disabledSpells?: string[]; spellPriority?: string[] };
    appearance?: { outfit: number; head: number; body: number; legs: number; feet: number; aura?: number; mount?: number; addons?: number };
  }>;
  /** Transient combat events produced by active party members. */
  partyEvents?: SimEvent[];
  guildId: number | null;
  decorations: string[];
  lastDummyTries: number;
  dummySkill: string;
  exerciseCharges?: number;
  arenaWins: number;
  arenaLosses: number;
  lootSlots: number;
  lootSlotCost: number;
  lootSlotCoinCost: number;
  supplySlots: number;
  supplySlotCost: number;
  supplySlotCoinCost: number;
  appearancePresets: Array<{ outfit: number; head: number; body: number; legs: number; feet: number; aura: number; mount: number; addons?: number }>;
  boosts: { xp: number; damage: number; loot: number; defense: number };
  charmPoints: number;
  charmPointsLeft: number;
  onboardingStep: number;
  queue: { huntId: string; position: number; size: number } | null;
  wheel: Record<string, number>;
  wheelPoints: number;
  wheelLeft: number;
  bosstiary: Record<string, number>;
  bossSlots: string[];
  bossPoints: number;
  bossSlotCap: number;
  /** Crystal bosstiary loot bonus % (before mastery +25 on slotted stage-3). */
  bossLootBonus: number;
  admin: boolean;
  policy: {
    healthPotionAt: number;
    manaPotionAt: number;
    fleeAt: number;
    stopWhenOutOfSupplies: boolean;
    spellPriority: string[];
    disabledSpells: string[];
    lootMinValue: number;
    healthPotionId: number;
    manaPotionId: number;
    healSpellId: string;
    healSpellAt: number;
    magicShield: boolean;
    magicShieldAt: number;
    autoAttack: boolean;
    taunt: boolean;
    lootToWarehouse: boolean;
    haste: boolean;
    food: boolean;
    cure?: boolean;
    runeId: number;
    soulRuneId?: number;
    supportRuneId?: number;
    virtueHarmony?: boolean;
    focusHarmony?: boolean;
    familiar?: boolean;
    bloodRage?: boolean;
    protector?: boolean;
    sharpshooter?: boolean;
    spiritPotionId?: number;
  };
  helperProfiles: {
    boss?: CharacterView['policy'];
    pvp?: CharacterView['policy'];
  };
  equipmentTiers: Record<string, number>;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  level: number;
  vocationId: number;
  appearance?: CharacterView['appearance'];
  active: boolean;
}

export interface RankRow {
  vocationId?: number;
  level?: number;
  appearance?: CharacterView['appearance'];
  id: number;
  name: string;
  value: number;
  extra?: number;
}

export interface MarketListing {
  id: number;
  seller: string;
  itemId: number;
  name: string;
  count: number;
  price: number;
  currency: string;
}

export interface ChatMessage {
  id: number;
  channel: string;
  author: string;
  body: string;
  at: number;
}

export interface WorldView {
  ranks: { level: RankRow[]; gold: RankRow[]; bestiary: RankRow[]; skill: RankRow[] };
  market: MarketListing[];
  online: Array<{ id: number; name: string; level: number; vocation: number }>;
  guilds: Array<{
    id: number;
    name: string;
    motd: string;
    leaderId: number;
    members: Array<{ characterId: number; name: string; rank: string }>;
  }>;
  chat: ChatMessage[];
  arena: Array<{ attacker: string; defender: string; winner: string; gold: number }>;
  catalogs: {
    imbuements: Array<{
      id: string;
      name: string;
      slots: string[];
      cost: readonly number[];
      description?: readonly string[];
      reagents?: Array<{ name: string; counts: readonly number[] }>;
    }>;
    decorations: Array<{ id: string; name: string; cost: number }>;
    shop: Array<{
      id: string;
      name: string;
      description: string;
      coins: number;
      kind: string;
      category: string;
      outfit?: number;
      outfitMale?: number | null;
      outfitFemale?: number | null;
      colors?: { head: number; body: number; legs: number; feet: number };
      mount?: number;
      mountClientId?: number;
      aura?: number;
      boostPercent?: number;
      boostDurationMs?: number;
      vipDays?: number;
      from?: string;
      premium?: boolean;
      itemId?: number;
      itemCount?: number;
    }>;
    npc: Array<{
      id: string;
      label: string;
      items: Array<{
        id: number;
        name: string;
        buyPrice: number | null;
        sellPrice: number | null;
        levelRequired: number;
        category: string;
      }>;
    }>;
    charms: Array<{ id: number; name: string; description: string | null; type: string; points: number[] }>;
    wheel: Array<{ id: string; name: string; damage: number; defense: number; experience: number; loot: number; health: number; mana: number }>;
    packs: Array<{ id: string; name: string; coins: number; brl: number }>;
  };
  event: { name: string; experience: number; loot: number };
  boosted?: { id: string; name: string } | null;
}

export interface HuntView {
  id: string;
  name: string;
  location: string;
  statedLevel: number;
  recommendedLevel: number | null;
  unlocked: boolean;
  expectedXpPerHour: number;
  estimatedRate: boolean;
  expectedLootPerHour: number;
  packSize: number;
  monsters: string[];
  premium: boolean;
  fit: number;
  supplyCost: number;
  profitPerHour?: number;
  recommended?: boolean;
  slots: { used: number; cap: number; queued: number };
  partySizes: Array<'solo' | 'duo' | 'party4'>;
  partyNeed: number;
  partyLocked: boolean;
}

export type BossCategory = 'boss' | 'raid' | 'event';

export interface BossView {
  id: string;
  huntId: string;
  name: string;
  monsterId: string;
  category: BossCategory;
  location: string;
  minLevel: number;
  description: string;
  experience: number;
  health: number;
  unlocked: boolean;
  onCooldown: boolean;
  cooldownUntil: number;
  cooldownRemainingMs: number;
}

export interface SettlementDelta {
  experience: number;
  kills: number;
  lootValue: number;
  supplyValue: number;
  levels: number;
}

export interface Settlement {
  elapsedSeconds: number;
  discardedSeconds?: number;
  stoppedBecause: string | null;
  offline?: boolean;
  efficiency?: number;
  capHours?: number;
  delta?: SettlementDelta;
  deathPenalty?: {
    lost: number;
    blessingsUsed: number;
    rate: number;
    aolUsed: boolean;
    pouchLost: number;
    skillsLost: number;
  } | null;
}
