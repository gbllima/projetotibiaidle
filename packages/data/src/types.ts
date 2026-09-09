/** Shapes of the JSON produced by tools/datagen. */

export type CombatType =
  | 'COMBAT_PHYSICALDAMAGE'
  | 'COMBAT_ENERGYDAMAGE'
  | 'COMBAT_EARTHDAMAGE'
  | 'COMBAT_FIREDAMAGE'
  | 'COMBAT_LIFEDRAIN'
  | 'COMBAT_MANADRAIN'
  | 'COMBAT_DROWNDAMAGE'
  | 'COMBAT_ICEDAMAGE'
  | 'COMBAT_HOLYDAMAGE'
  | 'COMBAT_DEATHDAMAGE'
  | 'COMBAT_HEALING';

export interface SpellCatalogEntry {
  spellid: number;
  name: string;
  formulaWithoutParams: string;
  spellGroupPrimary: string;
  spellGroupSecondary: string;
  iconIndex: number;
  minimumCasterLevel: number;
  aggressive: boolean;
  allowedVocations: string[];
  castCostMana?: number;
  manaCost?: number;
  manaCostPercent?: number;
  isRune?: boolean;
}

export interface MonsterAttack {
  kind: 'melee' | 'combat' | 'other';
  name: string;
  interval: number;
  chance: number;
  minDamage: number;
  maxDamage: number;
  damageType: CombatType;
  range: number | null;
  area: boolean;
  effect: string | null;
  shootEffect: string | null;
}

export interface MonsterHeal {
  interval: number;
  chance: number;
  min: number;
  max: number;
}

export interface LootDrop {
  itemId: number;
  itemName: string;
  /** Out of 100000. 39410 means 39.41%. */
  chance: number;
  maxCount: number;
}

export interface Bestiary {
  class: string;
  race: string;
  toKill: number;
  firstUnlock: number;
  secondUnlock: number;
  charmPoints: number;
  stars: number;
  locations: string | null;
}

export interface Monster {
  id: string;
  name: string;
  description: string | null;
  experience: number;
  health: number;
  speed: number;
  corpse: number | null;
  raceId: number | null;
  bloodType: string | null;
  lookType: number | null;
  lookTypeEx: number | null;
  outfit: Record<string, number> | null;
  category: string;
  isBoss: boolean;
  /** Crystal bosstiary rarity. Null when the monster is only a rewardBoss. */
  bosstiaryRace: 'bane' | 'archfoe' | 'nemesis' | null;
  bossRaceId: number | null;
  bestiary: Bestiary | null;
  armor: number;
  defense: number;
  mitigation: number;
  targetDistance: number;
  /** Absolute HP threshold where the creature flees (Crystal runAwayHealth). */
  runOnHealth: number;
  staticAttackChance: number;
  attacks: MonsterAttack[];
  heals: MonsterHeal[];
  /** Percent resistance by combat type. Positive resists, negative is a weakness. */
  elements: Partial<Record<CombatType, number>>;
  immunities: string[];
  loot: LootDrop[];
  summons: Array<{ name: string; chance: number; interval: number; count: number }>;
  flags: {
    hostile: boolean;
    attackable: boolean;
    pushable: boolean;
    rewardBoss: boolean;
    healthHidden: boolean;
  };
}

export interface Item {
  id: number;
  name: string;
  article: string | null;
  plural: string | null;
  /** Crystal items.xml description shown in the client inspect. */
  description: string | null;
  type: string | null;
  weaponType: string | null;
  /** Crystal 15.12 auto-attack swing id from items.xml (sword, monkstaff, …). */
  meleeAttackEffect: string | null;
  slot: string | null;
  attack: number;
  defense: number;
  extraDefense: number;
  armor: number;
  /** Hundredths of an oz. */
  weight: number;
  charges: number | null;
  runeSpellName: string | null;
  bonuses: Record<string, number>;
  imbuementSlots: number;
  /** Level required to equip, 0 when unrestricted. */
  levelRequired: number;
  /** Vocations that may equip it. Empty means all. */
  vocations: string[];
  range: number;
  hitChance: number | null;
  ammoType: string | null;
  shootType: string | null;
  containerSize: number | null;
  duration: number | null;
  stackable: boolean;
  marketCategory: number | null;
  hasSprite: boolean;
  /** Appearance id the client draws, which is not always the server id. */
  clientId: number | null;
  /** Best NPC sell price; null when no NPC buys it. */
  sellPrice: number | null;
  /** Cheapest NPC buy price; null when no NPC sells it. */
  buyPrice: number | null;
}

/** Wand/rod combat stats from items.xml `fromDamage`/`shootType`/`wandType`. */
export interface WandStats {
  id: number;
  name: string;
  shootType: string | null;
  wandType: string | null;
  fromDamage: number;
  toDamage: number;
  mana: number;
  levelRequired: number;
}

export const SKILL_NAMES = ['fist', 'club', 'sword', 'axe', 'distance', 'shield', 'fishing'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface Vocation {
  id: number;
  clientId: number;
  baseId: number;
  name: string;
  description: string;
  gainHp: number;
  gainMana: number;
  gainCap: number;
  gainHpTicks: number;
  gainHpAmount: number;
  gainManaTicks: number;
  gainManaAmount: number;
  manaMultiplier: number;
  attackSpeed: number;
  baseSpeed: number;
  soulMax: number;
  gainSoulTicks: number;
  meleeDamage: number;
  distDamage: number;
  wandRodDamage: number;
  defense: number;
  armor: number;
  mitigationMultiplier: number;
  mitigationPrimaryShield: number;
  mitigationSecondaryShield: number;
  skillMultipliers: Record<SkillName, number>;
}

export type HuntPartySize = 'solo' | 'duo' | 'party4';

export interface Hunt {
  id: string;
  name: string;
  level: number;
  location: string | null;
  partySizes: HuntPartySize[];
  /** Official CipSoft reference rate; our calibration target. */
  expectedXpPerHour: number;
  expectedLootPerHour: number;
  vocations: string[];
  premium: boolean;
  monsters: string[];
  valuableDrops: string[];
  recommendedSupplies: Record<string, string[]>;
}

/** 13×11 OTBM cut around a hunt WayPath.Position. */
export interface HuntMapRoom {
  center: { x: number; y: number; z: number };
  ground: number[][];
  stack: number[][][];
  filled: number;
}

export interface Charm {
  id: number;
  name: string;
  description: string | null;
  category: string;
  type: string;
  percent: number | null;
  chance: [number, number, number];
  points: [number, number, number];
}

export interface Stage {
  minLevel: number;
  maxLevel: number | null;
  multiplier: number;
}

export interface Stages {
  experience: Stage[];
  skills: Stage[];
  magicLevel: Stage[];
}

export interface PreyBonuses {
  damage: number[];
  defense: number[];
  experience: number[];
  loot: number[];
}

export interface OutfitCatalogEntry {
  id: string;
  name: string;
  coins: number;
  male: number | null;
  female: number | null;
  outfit: number;
  premium: boolean;
  from: string;
  unlocked: boolean;
  colors: { head: number; body: number; legs: number; feet: number };
}

export interface MountCatalogEntry {
  id: string;
  name: string;
  coins: number;
  /** Server mount id (appearance.mount / unlockedMounts). */
  mount: number;
  /** Client lookType used for sprites. */
  clientid: number;
  premium: boolean;
  from: string;
  speed: number;
}

export interface DataMeta {
  generatedAt: string;
  source: { protocol: string; server: string };
  counts: Record<string, number>;
  warnings: { parseErrors: string[]; duplicateNames: number; validation: string[] };
}
