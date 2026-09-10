import { charms, monsters, monstersById, mountsCatalog, outfitsCatalog, preyBonuses } from '@tibia-idle/data';
import { charmPassive } from './charms.js';
import { getWorldEvent, proficiencyMultiplier, slottedBossLootMultiplier, wheelBonus } from './endgame.js';
import type { CharacterState, PreyBonus } from './types.js';

export {
  PREY_DURATION_MS,
  PREY_LIST_REROLL_MS,
  PREY_GOLD_PER_LEVEL,
  PREY_REROLL_GOLD,
  PREY_WILDCARD_AUTO_BONUS,
  PREY_WILDCARD_LOCK,
  PREY_WILDCARD_PICK,
  emptyPreySlot,
  preySlotCount,
  preyBonusPercent,
  ensurePreySlots,
  expirePreySlots,
} from './prey.js';
export const VIP_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const PREY_LOCK_COINS = 10;
export const PARTY_SLOT_GOLD = 10_000;
export const PARTY_SLOT_COINS = 75;
export function partySlotPrices(unlockedSlots: number): { gold: number; coins: number } {
  return unlockedSlots < 2 ? { gold: PARTY_SLOT_GOLD, coins: PARTY_SLOT_COINS } : { gold: 100_000, coins: 500 };
}
export const GUILD_COST = 50_000;
export const GOLD_PER_COIN = 10_000;
export const DAILY_XP_BOOST = 0.1;
export const DAILY_XP_BOOST_MS = 2 * 60 * 60 * 1000;
export const TUTORIAL_HUNT_ID = 'venore-rotworm-cave';
export const LOOT_SLOT_GOLD = 10_000;
export const LOOT_SLOT_STEP = 1;
export const LOOT_SLOT_CAP = 1000;
export const LOOT_SLOT_DEFAULT = 20;
export const SUPPLY_SLOT_GOLD = 10_000;
export const SUPPLY_SLOT_STEP = 1;
export const SUPPLY_SLOT_CAP = 40;
export const SUPPLY_SLOT_DEFAULT = 20;
export const POUCH_SLOTS_PER_PAGE = 20;
export const DEPOT_SLOTS_PER_PAGE = 20;
export const DEPOT_PAGE_COUNT = 10;
export const DEPOT_SLOT_CAP = DEPOT_SLOTS_PER_PAGE * DEPOT_PAGE_COUNT;
export const LOOT_SLOT_COIN = 10;
export const SUPPLY_SLOT_COIN = 10;
export const PRESET_CAP = 3;

/** Gold for the next loot-pouch slot; doubles after each purchase from the base. */
export function lootSlotUpgradeCost(slots: number): number {
  const purchased = Math.max(0, slots - LOOT_SLOT_DEFAULT);
  return LOOT_SLOT_GOLD * (2 ** purchased);
}

/** Tibia Coins for the next loot-pouch slot; flat rate regardless of gold purchases. */
export function lootSlotCoinCost(_slots?: number): number {
  return LOOT_SLOT_COIN;
}

/** Gold for the next supply-pouch slot; doubles after each purchase from the base. */
export function supplySlotUpgradeCost(slots: number): number {
  const purchased = Math.max(0, slots - SUPPLY_SLOT_DEFAULT);
  return SUPPLY_SLOT_GOLD * (2 ** purchased);
}

/** Tibia Coins for the next supply-pouch slot; flat rate regardless of gold purchases. */
export function supplySlotCoinCost(_slots?: number): number {
  return SUPPLY_SLOT_COIN;
}

/** Crystal `!promotion`: level 20 and 20.000 gold. */
export const PROMOTION_LEVEL = 20;
export const PROMOTION_GOLD = 20_000;
export const PROMOTION_OF: Record<number, number> = { 1: 5, 2: 6, 3: 7, 4: 8, 9: 10 };

export const BOOSTED_EXPERIENCE = 1.5;
export const BOOSTED_LOOT = 1.25;

export function promotionTarget(vocationId: number): number | null {
  return PROMOTION_OF[vocationId] ?? null;
}

export function isPromoted(vocationId: number): boolean {
  return Object.values(PROMOTION_OF).includes(vocationId);
}

export function promoteCharacter(character: CharacterState): { ok: true } | { ok: false; reason: string } {
  const next = promotionTarget(character.vocationId);
  if (!next) return { ok: false, reason: 'You are already promoted.' };
  if (character.level < PROMOTION_LEVEL) {
    return { ok: false, reason: `Need level ${PROMOTION_LEVEL} to be promoted.` };
  }
  if (character.gold < PROMOTION_GOLD) {
    return { ok: false, reason: `Need ${PROMOTION_GOLD.toLocaleString('pt-BR')} gold.` };
  }
  character.gold -= PROMOTION_GOLD;
  character.vocationId = next;
  return { ok: true };
}

/**
 * CipSoft's daily boosted creature. One bestiary species per UTC day.
 * Extra XP/loot applies only when the hunt session recorded that id.
 */
export function dailyBoostedMonster(now = Date.now()): { id: string; name: string } | null {
  const pool = monsters.filter((monster) => monster.bestiary && !monster.isBoss);
  if (pool.length === 0) return null;
  const day = Math.floor(now / 86_400_000);
  const index = Math.abs((day * 1_103_515_245 + 12_345) % pool.length);
  const monster = pool[index]!;
  return { id: monster.id, name: monster.name };
}

export {
  IMBUEMENTS,
  IMBUEMENT_DURATION_MS,
  IMBUEMENT_BASE_COST,
  imbueReagentsFor,
  type ImbuementSpec,
} from './imbuements.js';

/**
 * Shared hunt XP like CipSoft party sharing: members within 2/3 of your
 * level, capped by unlocked party slots. 2 players +20%, +10% each extra,
 * max +60%. Bought slots still gate Duo/Party×4 caves.
 */
export function partyExperienceShare(memberLevels: number[], selfLevel: number, slotCap = 3): number {
  const cap = Math.max(1, Math.min(6, Math.floor(slotCap || 1)));
  if (cap < 2 || memberLevels.length === 0) return 1;
  const minLevel = Math.ceil((selfLevel * 2) / 3);
  const maxLevel = Math.floor((selfLevel * 3) / 2);
  const eligible = memberLevels
    .filter((level) => level >= minLevel && level <= maxLevel)
    .sort((a, b) => Math.abs(a - selfLevel) - Math.abs(b - selfLevel));
  const size = Math.min(cap, 1 + eligible.length);
  if (size < 2) return 1;
  return 1 + Math.min(0.6, size * 0.1);
}

export const DECORATIONS = [
  { id: 'torch', name: 'Tocha', cost: 500 },
  { id: 'banner', name: 'Estandarte', cost: 2_000 },
  { id: 'carpet', name: 'Tapete', cost: 1_500 },
  { id: 'fountain', name: 'Fonte', cost: 8_000 },
  { id: 'statue', name: 'Estátua', cost: 25_000 },
] as const;

export type ShopCategory = 'vip' | 'outfits' | 'mounts' | 'boosts' | 'services' | 'exercise';

export type ShopKind =
  | 'vip'
  | 'reroll'
  | 'rename'
  | 'colors'
  | 'outfit'
  | 'mount'
  | 'aura'
  | 'slot'
  | 'xp_boost'
  | 'loot_boost'
  | 'gold_boost'
  | 'exercise';

export interface ShopOffer {
  id: string;
  name: string;
  description: string;
  coins: number;
  kind: ShopKind;
  category: ShopCategory;
  outfit?: number;
  outfitMale?: number | null;
  outfitFemale?: number | null;
  colors?: { head: number; body: number; legs: number; feet: number };
  mount?: number;
  /** Client lookType for mount sprite previews. */
  mountClientId?: number;
  aura?: number;
  boostPercent?: number;
  boostDurationMs?: number;
  vipDays?: number;
  from?: string;
  premium?: boolean;
  /** Exercise weapon grant (shop). */
  itemId?: number;
  itemCount?: number;
}

export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  vip: 'Premium / VIP',
  outfits: 'Outfits',
  mounts: 'Montarias',
  boosts: 'Boosts',
  services: 'Serviços',
  exercise: 'Exercise',
};

const OUTFIT_SHOP: ShopOffer[] = outfitsCatalog.map((entry) => {
  const tag = entry.from === 'store' ? 'Store' : entry.from === 'quest' ? 'Quest' : entry.premium ? 'Premium' : 'Clássico';
  return {
    id: entry.id,
    name: entry.name,
    description: `${tag} · look ${entry.male ?? '—'}♂ / ${entry.female ?? '—'}♀ · cores customizáveis`,
    coins: entry.coins,
    kind: 'outfit' as const,
    category: 'outfits' as const,
    outfit: entry.outfit,
    outfitMale: entry.male,
    outfitFemale: entry.female,
    colors: entry.colors,
    from: entry.from,
    premium: entry.premium,
  };
});

const MOUNT_SHOP: ShopOffer[] = mountsCatalog.map((entry) => {
  const tag = entry.from === 'store' ? 'Store' : entry.from === 'quest' ? 'Quest' : 'Montaria';
  return {
    id: entry.id,
    name: entry.name,
    description: `${tag} · speed +${entry.speed} · look ${entry.clientid}`,
    coins: entry.coins,
    kind: 'mount' as const,
    category: 'mounts' as const,
    mount: entry.mount,
    mountClientId: entry.clientid,
    from: entry.from,
    premium: entry.premium,
  };
});

/** Durable exercise weapons (500 charges) — sold for Tibia Coins. */
const EXERCISE_SHOP: ShopOffer[] = [
  { id: 'ex_sword', name: 'Exercise Sword', description: '500 cargas · +7 tries de sword por uso no dummy', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28552, itemCount: 500 },
  { id: 'ex_axe', name: 'Exercise Axe', description: '500 cargas · +7 tries de axe por uso', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28553, itemCount: 500 },
  { id: 'ex_club', name: 'Exercise Club', description: '500 cargas · +7 tries de club por uso', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28554, itemCount: 500 },
  { id: 'ex_bow', name: 'Exercise Bow', description: '500 cargas · +7 tries de distance por uso', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28555, itemCount: 500 },
  { id: 'ex_rod', name: 'Exercise Rod', description: '500 cargas · +600 mana spent por uso (ML)', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28556, itemCount: 500 },
  { id: 'ex_wand', name: 'Exercise Wand', description: '500 cargas · +600 mana spent por uso (ML)', coins: 25, kind: 'exercise', category: 'exercise', itemId: 28557, itemCount: 500 },
  { id: 'ex_shield', name: 'Exercise Shield', description: '500 cargas · +7 tries de shielding por uso', coins: 25, kind: 'exercise', category: 'exercise', itemId: 44065, itemCount: 500 },
  { id: 'ex_wraps', name: 'Exercise Wraps', description: '500 cargas · +7 tries de fist por uso', coins: 25, kind: 'exercise', category: 'exercise', itemId: 50292, itemCount: 500 },
  { id: 'ex_sword_l', name: 'Lasting Exercise Sword', description: '1800 cargas · treino prolongado', coins: 75, kind: 'exercise', category: 'exercise', itemId: 35279, itemCount: 1800 },
  { id: 'ex_bow_l', name: 'Lasting Exercise Bow', description: '1800 cargas · treino prolongado', coins: 75, kind: 'exercise', category: 'exercise', itemId: 35282, itemCount: 1800 },
  { id: 'ex_rod_l', name: 'Lasting Exercise Rod', description: '1800 cargas · treino prolongado', coins: 75, kind: 'exercise', category: 'exercise', itemId: 35283, itemCount: 1800 },
];

export const SHOP: ShopOffer[] = [
  { id: 'vip7', name: 'Premium 7 dias', description: 'Premium Account por 7 dias · +5% XP · 4º Prey · stamina 1.5×', coins: 250, kind: 'vip', category: 'vip', vipDays: 7 },
  { id: 'vip30', name: 'Premium 30 dias', description: 'Premium Account por 30 dias · +5% XP · 4º Prey · stamina 1.5×', coins: 900, kind: 'vip', category: 'vip', vipDays: 30 },
  { id: 'xp_boost_1h', name: 'XP Boost 1h', description: '+25% experiência de hunt por 1 hora', coins: 15, kind: 'xp_boost', category: 'boosts', boostPercent: 25, boostDurationMs: 60 * 60 * 1000 },
  { id: 'xp_boost_4h', name: 'XP Boost 4h', description: '+25% experiência de hunt por 4 horas', coins: 45, kind: 'xp_boost', category: 'boosts', boostPercent: 25, boostDurationMs: 4 * 60 * 60 * 1000 },
  { id: 'loot_boost_1h', name: 'Loot Boost 1h', description: '+20% loot por 1 hora', coins: 15, kind: 'loot_boost', category: 'boosts', boostPercent: 20, boostDurationMs: 60 * 60 * 1000 },
  { id: 'loot_boost_4h', name: 'Loot Boost 4h', description: '+20% loot por 4 horas', coins: 45, kind: 'loot_boost', category: 'boosts', boostPercent: 20, boostDurationMs: 4 * 60 * 60 * 1000 },
  { id: 'gold_boost_1h', name: 'Gold Boost 1h', description: '+20% gold (moedas) do loot por 1 hora', coins: 15, kind: 'gold_boost', category: 'boosts', boostPercent: 20, boostDurationMs: 60 * 60 * 1000 },
  { id: 'gold_boost_4h', name: 'Gold Boost 4h', description: '+20% gold (moedas) do loot por 4 horas', coins: 45, kind: 'gold_boost', category: 'boosts', boostPercent: 20, boostDurationMs: 4 * 60 * 60 * 1000 },
  ...OUTFIT_SHOP,
  ...MOUNT_SHOP,
  ...EXERCISE_SHOP,
  { id: 'rerolls5', name: '5 rerolls de Prey', description: '5 rerolls instantâneos de Prey', coins: 20, kind: 'reroll', category: 'services' },
  { id: 'rename', name: 'Trocar nickname', description: 'Altera o nome do personagem', coins: 100, kind: 'rename', category: 'services' },
  { id: 'colors', name: 'Randomizar cores', description: 'Novas cores aleatórias do outfit', coins: 10, kind: 'colors', category: 'services' },
  { id: 'char_slot', name: 'Slot de personagem', description: 'Desbloqueia +1 slot na conta', coins: 150, kind: 'slot', category: 'services' },
  { id: 'aura_gold', name: 'Aura dourada', description: 'Aura dourada no personagem', coins: 120, kind: 'aura', category: 'services', aura: 1 },
  { id: 'aura_red', name: 'Aura vermelha', description: 'Aura vermelha no personagem', coins: 120, kind: 'aura', category: 'services', aura: 2 },
];

export function outfitLookForGender(offer: ShopOffer, gender: 'm' | 'f'): number | null {
  if (gender === 'f') return offer.outfitFemale ?? null;
  return offer.outfitMale ?? null;
}

/** True if lookType is valid for this sex (not the other gender's id). */
export function outfitMatchesGender(lookType: number, gender: 'm' | 'f'): boolean {
  let matchedOwn = false;
  for (const entry of outfitsCatalog) {
    if (gender === 'f') {
      if (entry.female === lookType) matchedOwn = true;
      if (entry.male === lookType && entry.female !== lookType) return false;
    } else {
      if (entry.male === lookType) matchedOwn = true;
      if (entry.female === lookType && entry.male !== lookType) return false;
    }
  }
  // Unknown lookTypes (not in catalog) stay allowed.
  return matchedOwn || !outfitsCatalog.some((entry) => entry.male === lookType || entry.female === lookType);
}

export function unlockOutfitOffer(character: CharacterState, offer: ShopOffer): void {
  character.unlockedOutfits ??= [character.appearance.outfit];
  for (const look of [offer.outfitMale, offer.outfitFemale, offer.outfit]) {
    if (look != null && !character.unlockedOutfits.includes(look)) {
      character.unlockedOutfits.push(look);
    }
  }
  const look = outfitLookForGender(offer, character.gender ?? 'm');
  if (look != null) character.appearance.outfit = look;
  if (offer.colors) {
    character.appearance.head = offer.colors.head;
    character.appearance.body = offer.colors.body;
    character.appearance.legs = offer.colors.legs;
    character.appearance.feet = offer.colors.feet;
  }
}

export function ownsShopOutfitOffer(character: CharacterState, offer: ShopOffer): boolean {
  const unlocked = character.unlockedOutfits ?? [];
  const looks = [offer.outfitMale, offer.outfitFemale, offer.outfit].filter((id): id is number => id != null);
  return looks.length > 0 && looks.every((id) => unlocked.includes(id));
}

export function applyStoreBoost(
  character: CharacterState,
  kind: 'xp_boost' | 'loot_boost' | 'gold_boost',
  percent: number,
  durationMs: number,
  now = Date.now(),
): void {
  const bonus = percent / 100;
  const extend = (until: number) => Math.max(until, now) + durationMs;
  if (kind === 'xp_boost') {
    character.storeXpBoostUntil = extend(character.storeXpBoostUntil ?? 0);
    character.storeXpBoostBonus = Math.max(character.storeXpBoostBonus ?? 0, bonus);
  } else if (kind === 'loot_boost') {
    character.storeLootBoostUntil = extend(character.storeLootBoostUntil ?? 0);
    character.storeLootBoostBonus = Math.max(character.storeLootBoostBonus ?? 0, bonus);
  } else {
    character.storeGoldBoostUntil = extend(character.storeGoldBoostUntil ?? 0);
    character.storeGoldBoostBonus = Math.max(character.storeGoldBoostBonus ?? 0, bonus);
  }
}

export function ownsShopOutfit(character: CharacterState, outfit: number): boolean {
  return (character.unlockedOutfits ?? []).includes(outfit);
}

export function ownsShopMount(character: CharacterState, mount: number): boolean {
  return (character.unlockedMounts ?? []).includes(mount);
}

export function defaultAppearance(vocationId: number) {
  const outfits: Record<number, number> = { 1: 130, 2: 144, 3: 137, 4: 131, 9: 128 };
  return {
    outfit: outfits[vocationId] ?? 128,
    head: 78,
    body: 94,
    legs: 114,
    feet: 115,
    aura: 0,
    mount: 0,
    addons: 0,
  };
}

export function isVip(character: CharacterState, now = 0): boolean {
  return character.premium && (character.vipUntil ?? 0) > now;
}

export function charmPointsEarned(character: CharacterState): number {
  let points = 0;
  for (const [id, kills] of Object.entries(character.bestiary ?? {})) {
    const monster = monstersById.get(id);
    const goal = monster?.bestiary?.toKill ?? 0;
    if (monster?.bestiary && goal > 0 && kills >= goal) points += monster.bestiary.charmPoints;
  }
  return points;
}

export function charmPointsSpent(character: CharacterState): number {
  let spent = 0;
  for (const charmId of character.charmsUnlocked ?? []) {
    const charm = charms.find((entry) => entry.id === charmId);
    if (charm) spent += charm.points[0];
  }
  return spent;
}

export function charmPointsLeft(character: CharacterState): number {
  return Math.max(0, charmPointsEarned(character) - charmPointsSpent(character));
}

export type BestiaryStage = 'unknown' | 'observed' | 'proficient' | 'adept' | 'mastered';

/**
 * CipSoft bestiary proficiency.
 *
 * firstUnlock / secondUnlock / toKill come from the monster's own table.
 * Combat already applies +2% damage, +2% loot and +3% XP at those gates.
 */
export function bestiaryStage(kills: number, firstUnlock: number, secondUnlock: number, toKill: number): BestiaryStage {
  if (kills <= 0) return 'unknown';
  if (toKill > 0 && kills >= toKill) return 'mastered';
  if (secondUnlock > 0 && kills >= secondUnlock) return 'adept';
  if (firstUnlock > 0 && kills >= firstUnlock) return 'proficient';
  return 'observed';
}

/** Multipliers applied in combat. 1.13 means +13%. */
export function huntMultipliers(
  character: CharacterState,
  monsterId: string,
  now = 0,
  partyLevels: number[] = [],
  boostedMonsterId?: string,
): {
  damage: number;
  defense: number;
  experience: number;
  /** Non-money loot value (items). Store loot boost applies here. */
  loot: number;
  /** Money drops (gold/platinum/crystal). Store gold boost applies here. */
  gold: number;
} {
  let damage = 1;
  let defense = 0;
  let experience = 1;
  let loot = 1;

  if (isVip(character, now)) experience *= 1.05;
  if ((character.xpBoostUntil ?? 0) > now) experience *= 1 + DAILY_XP_BOOST;
  if ((character.storeXpBoostUntil ?? 0) > now) experience *= 1 + (character.storeXpBoostBonus ?? 0);
  experience *= partyExperienceShare(partyLevels, character.level, character.partySlots ?? 1);
  if (character.guildId) experience *= 1.03;

  const wheel = wheelBonus(character);
  damage *= 1 + wheel.damage;
  defense += wheel.defense;
  experience *= 1 + wheel.experience;
  loot *= 1 + wheel.loot;
  damage *= proficiencyMultiplier(character);

  const event = getWorldEvent();
  experience *= event.experience;
  loot *= event.loot;

  if (boostedMonsterId && boostedMonsterId === monsterId) {
    experience *= BOOSTED_EXPERIENCE;
    loot *= BOOSTED_LOOT;
  }

  if ((character.bossSlots ?? []).includes(monsterId)) {
    loot *= slottedBossLootMultiplier(character, monsterId);
  }

  const influence = character.forge?.[monsterId] ?? 0;
  if (influence > 0) {
    const bonus = Math.min(100, influence) * 0.002;
    experience *= 1 + bonus;
    loot *= 1 + bonus;
  }

  const bestiary = monstersById.get(monsterId)?.bestiary;
  const kills = character.bestiary?.[monsterId] ?? 0;
  if (bestiary) {
    if (kills >= bestiary.firstUnlock) damage *= 1.02;
    if (kills >= bestiary.secondUnlock) loot *= 1.02;
    if (bestiary.toKill > 0 && kills >= bestiary.toKill) experience *= 1.03;
  }

  for (const slot of character.prey ?? []) {
    if (!slot.monsterId || slot.expiresAt <= now) continue;
    if (slot.monsterId !== monsterId) continue;
    const table = preyBonuses[slot.bonus as PreyBonus];
    const percent = table[Math.min(table.length - 1, Math.max(0, slot.star))] ?? 0;
    if (slot.bonus === 'damage') damage *= 1 + percent / 100;
    if (slot.bonus === 'defense') defense += percent / 100;
    if (slot.bonus === 'experience') experience *= 1 + percent / 100;
    if (slot.bonus === 'loot') loot *= 1 + percent / 100;
  }

  const charm = charmPassive(character, monsterId);
  damage *= charm.damage;
  defense += charm.defense + charm.dodge;
  experience *= charm.experience;
  loot *= charm.loot;

  // Store boosts are channel-specific: loot items vs money drops.
  let gold = loot;
  if ((character.storeLootBoostUntil ?? 0) > now) loot *= 1 + (character.storeLootBoostBonus ?? 0);
  if ((character.storeGoldBoostUntil ?? 0) > now) gold *= 1 + (character.storeGoldBoostBonus ?? 0);

  return { damage, defense: Math.min(0.4, defense), experience, loot, gold };
}

export function activeBoosts(character: CharacterState, now = 0, partyLevels: number[] = []): {
  xp: number;
  damage: number;
  loot: number;
  defense: number;
} {
  const sample = huntMultipliers(
    character,
    character.prey?.find((slot) => slot.monsterId)?.monsterId ?? '',
    now,
    partyLevels,
  );
  return {
    xp: Math.round((sample.experience - 1) * 1000) / 10,
    damage: Math.round((sample.damage - 1) * 1000) / 10,
    loot: Math.round((sample.loot - 1) * 1000) / 10,
    defense: Math.round(sample.defense * 1000) / 10,
  };
}
