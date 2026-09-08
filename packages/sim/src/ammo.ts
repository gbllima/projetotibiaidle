import { itemsById, type CombatType, type Item } from '@tibia-idle/data';
import {
  combatAreaOffsets, isInCombatArea, meleeSurroundSpots, PLAYER_TILE, type CombatAreaId,
} from './areas.js';
import { ATTACK_FACTOR, maxWeaponDamage, minWeaponDamage } from './formulas.js';
import type { ActiveMonster, CharacterState, DerivedStats } from './types.js';

/**
 * Distance ammunition profiles from Crystal Server.
 *
 * Scripted AoE (burst / diamond / *storm) live in
 * `servidor/data/scripts/weapons/scripts/*arrow*.lua`. Elemental split follows
 * `WeaponDistance::getWeaponDamage` + primary/secondary split in weapons.cpp.
 */

export type AmmoKind = 'arrow' | 'bolt' | 'spear' | 'throwable';

export interface AmmoPoisonDot {
  damage: number;
  ticks: number;
  intervalMs: number;
  damageType: CombatType;
}

export interface AmmoProfile {
  itemId: number;
  name: string;
  kind: AmmoKind;
  /** Physical attack attribute (items.xml / Weapon:attack). */
  attack: number;
  /** Elemental attack for flash/flaming/etc. (element* in items.xml). */
  elementAttack: number;
  elementType?: CombatType;
  area: boolean;
  /** Crystal createCombatArea shape centered on the arrow impact tile. */
  areaShape?: AmmoAreaShape;
  /** CONST_ME_* painted on each hit when area. */
  effect?: string;
  shoot: string;
  level: number;
  /** Crystal maxHitChance (0–100). */
  hitChance: number;
  /** Crystal maxHitChance tier when hitChance is 0 (75 / 90 / 100). */
  maxHitChance?: number;
  poison?: AmmoPoisonDot;
  /** Diamond arrow custom distance formula. */
  diamondFormula?: boolean;
}

/** Matches Crystal `createCombatArea` tables in weapons/scripts/*arrow*.lua. */
export type AmmoAreaShape = Extract<CombatAreaId, 'burst3' | 'diamond5' | 'storm5'>;

const ELEMENTAL: Record<number, { element: CombatType; amount: number }> = {
  761: { element: 'COMBAT_ENERGYDAMAGE', amount: 14 },
  762: { element: 'COMBAT_ICEDAMAGE', amount: 14 },
  763: { element: 'COMBAT_FIREDAMAGE', amount: 14 },
  774: { element: 'COMBAT_EARTHDAMAGE', amount: 14 },
  16143: { element: 'COMBAT_EARTHDAMAGE', amount: 27 },
};

/** Scripted / special ammo — overrides generic item stats where Crystal disagrees. */
const SPECIAL: AmmoProfile[] = [
  {
    itemId: 3448, name: 'poison arrow', kind: 'arrow',
    attack: 21, elementAttack: 0, area: false,
    shoot: 'CONST_ANI_POISONARROW', level: 0, hitChance: 91,
    poison: {
      damage: 2, ticks: 16, intervalMs: 4000, damageType: 'COMBAT_EARTHDAMAGE',
    },
  },
  {
    itemId: 3449, name: 'burst arrow', kind: 'arrow',
    attack: 27, elementAttack: 0, area: true, areaShape: 'burst3',
    effect: 'CONST_ME_EXPLOSIONAREA',
    shoot: 'CONST_ANI_BURSTARROW', level: 0, hitChance: 100,
  },
  {
    itemId: 25757, name: 'diamond arrow', kind: 'arrow',
    attack: 37, elementAttack: 0, area: true, areaShape: 'diamond5',
    effect: 'CONST_ME_ENERGYHIT',
    shoot: 'CONST_ANI_DIAMONDARROW', level: 150, hitChance: 100,
    diamondFormula: true,
  },
  {
    itemId: 35901, name: 'diamond arrow', kind: 'arrow',
    attack: 37, elementAttack: 0, area: true, areaShape: 'diamond5',
    effect: 'CONST_ME_ENERGYHIT',
    shoot: 'CONST_ANI_DIAMONDARROW', level: 150, hitChance: 100,
    diamondFormula: true,
  },
  {
    itemId: 53168, name: 'shatterstorm arrow', kind: 'arrow',
    attack: 27, elementAttack: 0, area: true, areaShape: 'storm5',
    effect: 'CONST_ME_HITAREA',
    shoot: 'CONST_ANI_SHATTERSTORMARROW', level: 50, hitChance: 100,
  },
  {
    itemId: 53169, name: 'firestorm arrow', kind: 'arrow',
    attack: 21, elementAttack: 0, area: true, areaShape: 'storm5',
    elementType: 'COMBAT_FIREDAMAGE',
    effect: 'CONST_ME_FIREATTACK',
    shoot: 'CONST_ANI_FIRESTORMARROW', level: 125, hitChance: 100,
  },
  {
    itemId: 53170, name: 'terrastorm arrow', kind: 'arrow',
    attack: 21, elementAttack: 0, area: true, areaShape: 'storm5',
    elementType: 'COMBAT_EARTHDAMAGE',
    effect: 'CONST_ME_CARNIPHILA',
    shoot: 'CONST_ANI_TERRASTORMARROW', level: 125, hitChance: 100,
  },
  {
    itemId: 53171, name: 'froststorm arrow', kind: 'arrow',
    attack: 21, elementAttack: 0, area: true, areaShape: 'storm5',
    elementType: 'COMBAT_ICEDAMAGE',
    effect: 'CONST_ME_ICEATTACK',
    shoot: 'CONST_ANI_FROSTSTORMARROW', level: 125, hitChance: 100,
  },
  {
    itemId: 53172, name: 'thunderstorm arrow', kind: 'arrow',
    attack: 21, elementAttack: 0, area: true, areaShape: 'storm5',
    elementType: 'COMBAT_ENERGYDAMAGE',
    effect: 'CONST_ME_ENERGYHIT',
    shoot: 'CONST_ANI_THUNDERSTORMARROW', level: 125, hitChance: 100,
  },
];

const SPECIAL_BY_ID = new Map(SPECIAL.map((entry) => [entry.itemId, entry]));

const HIT_CHANCE_BY_ID: Record<number, number> = {
  3447: 91, 21470: 40, 7364: 100, 7365: 94, 14251: 94, 15793: 95,
  3446: 87, 3450: 91, 7363: 87, 6528: 91, 14252: 89, 16141: 90, 16142: 90,
  25758: 100, 35902: 100,
  761: 91, 762: 91, 763: 91, 774: 91, 16143: 93,
};

function kindOf(item: Item): AmmoKind {
  const ammo = (item.ammoType ?? '').toLowerCase();
  if (ammo === 'bolt') return 'bolt';
  if (ammo === 'arrow') return 'arrow';
  const name = item.name.toLowerCase();
  if (name.includes('bolt')) return 'bolt';
  if (name.includes('spear')) return 'spear';
  if (name.includes('arrow')) return 'arrow';
  return 'throwable';
}

function shootOf(item: Item, kind: AmmoKind): string {
  const raw = (item.shootType ?? kind).toUpperCase().replace(/\s+/g, '');
  if (raw.startsWith('CONST_ANI_')) return raw;
  return `CONST_ANI_${raw}`;
}

export function isAmmoItem(item: Item | null | undefined): boolean {
  if (!item) return false;
  if (item.weaponType === 'ammunition' || item.weaponType === 'ammo') return true;
  if (item.ammoType) return true;
  const name = item.name.toLowerCase();
  return /\b(arrow|bolt)\b/.test(name) || name === 'spear';
}

/** Build the combat profile for an ammo item id. */
export function ammoProfile(itemId: number): AmmoProfile | null {
  const special = SPECIAL_BY_ID.get(itemId);
  if (special) return special;

  const item = itemsById.get(itemId);
  if (!item || !isAmmoItem(item)) return null;

  const kind = kindOf(item);
  const elemental = ELEMENTAL[itemId];
  const level = item.levelRequired ?? 0;
  return {
    itemId,
    name: item.name,
    kind,
    attack: Math.max(0, item.attack),
    elementAttack: elemental?.amount ?? 0,
    elementType: elemental?.element,
    area: false,
    shoot: shootOf(item, kind),
    level,
    hitChance: HIT_CHANCE_BY_ID[itemId] ?? item.hitChance ?? 90,
  };
}

/** Bow/crossbow attack added on top of ammo (Crystal WeaponDistance). */
export function equippedBowAttack(character: CharacterState): number {
  for (const slot of ['left', 'right'] as const) {
    const id = character.equipment[slot];
    if (!id) continue;
    const item = itemsById.get(id);
    if (!item) continue;
    if (item.weaponType === 'distance' || /\b(bow|crossbow)\b/i.test(item.name)) {
      return Math.max(0, item.attack);
    }
  }
  return 0;
}

/**
 * Attack value fed into the distance weapon formula.
 * Elemental ammo: physical + element + bow (then halved vs monsters in range).
 */
export function ammoAttackValue(character: CharacterState, profile: AmmoProfile): number {
  return profile.attack + profile.elementAttack + equippedBowAttack(character);
}

/** Damage range before defenses — mirrors Crystal distance weapon math. */
export function ammoDamageRange(
  character: CharacterState,
  stats: DerivedStats,
  profile: AmmoProfile,
): { min: number; max: number } {
  const attackValue = ammoAttackValue(character, profile);

  if (profile.diamondFormula) {
    const min = character.level * 0.2;
    const max = (0.09 * ATTACK_FACTOR) * stats.attackSkill * attackValue + character.level * 0.2;
    return { min: Math.max(1, Math.floor(min)), max: Math.max(Math.floor(min), Math.round(max)) };
  }

  let min = minWeaponDamage(character.level, attackValue);
  let max = maxWeaponDamage(character.level, stats.attackSkill, attackValue, ATTACK_FACTOR, false);

  // Crystal halves vs monsters when the ammo has an elemental component.
  if (profile.elementAttack > 0) {
    min = Math.floor(min / 2);
    max = Math.floor(max / 2);
  }

  return { min: Math.min(min, max), max: Math.max(1, max) };
}

/** Split a rolled hit into physical + elemental portions (weapons.cpp). */
export function splitAmmoDamage(
  profile: AmmoProfile,
  total: number,
): Array<{ amount: number; damageType: CombatType }> {
  // Pure elemental AoE (firestorm etc.): whole hit is that element.
  if (profile.area && profile.elementType && profile.elementAttack <= 0) {
    return [{ amount: total, damageType: profile.elementType }];
  }

  const physical = profile.attack;
  const elemental = profile.elementAttack;
  if (elemental <= 0 || !profile.elementType) {
    return [{ amount: total, damageType: 'COMBAT_PHYSICALDAMAGE' }];
  }

  const combined = physical + elemental;
  const physAmount = Math.round((total * physical) / combined);
  const elemAmount = Math.max(0, total - physAmount);
  const parts: Array<{ amount: number; damageType: CombatType }> = [];
  if (physAmount > 0) parts.push({ amount: physAmount, damageType: 'COMBAT_PHYSICALDAMAGE' });
  if (elemAmount > 0) parts.push({ amount: elemAmount, damageType: profile.elementType });
  return parts.length ? parts : [{ amount: total, damageType: 'COMBAT_PHYSICALDAMAGE' }];
}

export function ammoById(itemId: number): AmmoProfile | undefined {
  return ammoProfile(itemId) ?? undefined;
}

/** All known special ammo profiles (for UI / tests). */
export function specialAmmoProfiles(): readonly AmmoProfile[] {
  return SPECIAL;
}

/**
 * Whether (x,y) is inside the Crystal combat area centered on the impact tile.
 * Burst = full 3×3. Diamond = rounded 5×5. Storm = 13-tile cross.
 */
export function isInAmmoSplash(
  shape: AmmoAreaShape,
  focusX: number,
  focusY: number,
  x: number,
  y: number,
): boolean {
  return isInCombatArea(shape, focusX, focusY, x, y);
}

/**
 * Melee ring around the player — same seats the client uses for the monster box.
 * Burst 3×3 on the impact seat hits neighbors (Crystal), not the whole pack.
 */
export function packStandTiles(
  active: readonly ActiveMonster[],
): Map<number, { x: number; y: number }> {
  const spots = meleeSurroundSpots(PLAYER_TILE.x, PLAYER_TILE.y);
  const sorted = [...active].sort((a, b) => a.uid - b.uid);
  const map = new Map<number, { x: number; y: number }>();
  sorted.forEach((monster, index) => {
    const spot = spots[index] ?? {
      x: PLAYER_TILE.x + (index % 3) - 1,
      y: PLAYER_TILE.y + 1 + Math.floor(index / 3),
    };
    map.set(monster.uid, spot);
  });
  return map;
}

/**
 * Creatures hit by AoE ammo: only those on a SQM inside the Crystal area
 * centered on the focused impact tile (burst = 9 SQM).
 */
export function ammoSplashVictims(
  active: readonly ActiveMonster[],
  focus: ActiveMonster,
  shape: AmmoAreaShape,
): ActiveMonster[] {
  const fallback = packStandTiles(active);
  const focusX = focus.tileX ?? fallback.get(focus.uid)?.x ?? PLAYER_TILE.x;
  const focusY = focus.tileY ?? fallback.get(focus.uid)?.y ?? PLAYER_TILE.y;
  const hit: ActiveMonster[] = [];
  for (const monster of active) {
    const x = monster.tileX ?? fallback.get(monster.uid)?.x;
    const y = monster.tileY ?? fallback.get(monster.uid)?.y;
    if (x === undefined || y === undefined) continue;
    if (isInAmmoSplash(shape, focusX, focusY, x, y)) hit.push(monster);
  }
  if (!hit.some((monster) => monster.uid === focus.uid)) hit.unshift(focus);
  return hit;
}

/** Assign spread stand tiles so ammo splash matches Crystal impact seats. */
export function layoutPackMonsters(active: ActiveMonster[]): void {
  const tiles = packStandTiles(active);
  for (const monster of active) {
    const tile = tiles.get(monster.uid);
    if (!tile) continue;
    monster.tileX = tile.x;
    monster.tileY = tile.y;
  }
}

/** Offsets for painting Crystal ammo areas on the client. */
export function ammoAreaOffsets(shape: AmmoAreaShape): ReadonlyArray<readonly [number, number]> {
  return combatAreaOffsets(shape);
}
