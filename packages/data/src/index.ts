import monstersJson from '../generated/monsters.json' with { type: 'json' };
import itemsJson from '../generated/items.json' with { type: 'json' };
import huntsJson from '../generated/hunts.json' with { type: 'json' };
import huntMapsJson from '../generated/hunt-maps.json' with { type: 'json' };
import huntLevelsJson from '../generated/hunt-levels.json' with { type: 'json' };
import vocationsJson from '../generated/vocations.json' with { type: 'json' };
import charmsJson from '../generated/charms.json' with { type: 'json' };
import stagesJson from '../generated/stages.json' with { type: 'json' };
import preyJson from '../generated/prey.json' with { type: 'json' };
import bossEncountersJson from '../generated/boss-encounters.json' with { type: 'json' };
import wandsJson from '../generated/wands.json' with { type: 'json' };
import outfitsCatalogJson from '../generated/outfits-catalog.json' with { type: 'json' };
import mountsCatalogJson from '../generated/mounts-catalog.json' with { type: 'json' };
import metaJson from '../generated/meta.json' with { type: 'json' };
import spellsCatalogJson from '../generated/spells.json' with { type: 'json' };

import type {
  Charm, DataMeta, Hunt, HuntMapRoom, Item, Monster, MountCatalogEntry, OutfitCatalogEntry, PreyBonuses, SpellCatalogEntry, Stages, Vocation, WandStats,
} from './types.js';

export * from './types.js';
export * from './city.js';

export const monsters = monstersJson as unknown as Monster[];
export const items = itemsJson as unknown as Item[];
export const hunts = huntsJson as unknown as Hunt[];
export const huntMaps = huntMapsJson as unknown as Record<string, HuntMapRoom>;
export const vocations = vocationsJson as unknown as Vocation[];
export const charms = charmsJson as unknown as Charm[];
export const stages = stagesJson as unknown as Stages;
export const preyBonuses = preyJson as unknown as PreyBonuses;
export const wands = wandsJson as unknown as WandStats[];
export const spellsCatalog = spellsCatalogJson as unknown as SpellCatalogEntry[];
export const outfitsCatalog = outfitsCatalogJson as unknown as OutfitCatalogEntry[];
export const mountsCatalog = mountsCatalogJson as unknown as MountCatalogEntry[];
export const meta = metaJson as unknown as DataMeta;

/**
 * Calibrated efficient level per hunt, keyed by hunt id then vocation id.
 * Produced by simulation rather than taken from the source data.
 */
export const huntLevels = huntLevelsJson as unknown as Record<string, Record<string, number>>;

export type BossCategory = 'boss' | 'raid' | 'event';

export interface BossEncounter {
  id: string;
  monsterId: string;
  category: BossCategory;
  location: string;
  minLevel: number;
  description: string;
}

export const bossEncounters = bossEncountersJson as unknown as BossEncounter[];
export const bossEncountersById: ReadonlyMap<string, BossEncounter> = new Map(
  bossEncounters.map((entry) => [entry.id, entry]),
);

/**
 * Hunt-level tables are keyed by the five starting vocations (1–4, 9).
 * Promoted ids (MS/ED/RP/EK/Exalted Monk) reuse the base vocation's curve.
 */
export function huntVocationKey(vocationId: number): number {
  const promoted: Record<number, number> = { 5: 1, 6: 2, 7: 3, 8: 4, 10: 9 };
  return promoted[vocationId] ?? vocationId;
}

/** Raw simulation-derived efficiency level, without starter-zone access rules. */
export function calibratedLevelFor(huntId: string, vocationId?: number): number | null {
  const entry = huntLevels[huntId];
  if (!entry) return null;
  if (vocationId !== undefined) {
    return entry[String(vocationId)] ?? entry[String(huntVocationKey(vocationId))] ?? null;
  }
  const levels = Object.values(entry);
  return levels.length ? Math.min(...levels) : null;
}

/**
 * Level shown and enforced by the game. Starter level-8 zones remain available
 * immediately; later zones use the vocation-specific calibrated requirement.
 */
export function recommendedLevelFor(huntId: string, vocationId?: number): number | null {
  const calibrated = calibratedLevelFor(huntId, vocationId);
  if (calibrated === null) return null;
  const hunt = huntsById.get(huntId);
  return hunt?.level !== undefined && hunt.level <= 8 ? hunt.level : calibrated;
}

/** Explicit alias for code that deals with access rather than calibration. */
export function accessLevelFor(huntId: string, vocationId: number): number | null {
  return recommendedLevelFor(huntId, vocationId);
}

export const monstersById: ReadonlyMap<string, Monster> = new Map(monsters.map((m) => [m.id, m]));
export const itemsById: ReadonlyMap<number, Item> = new Map(items.map((i) => [i.id, i]));
function preferItem(existing: Item, candidate: Item): Item {
  if (candidate.buyPrice !== null && existing.buyPrice === null) return candidate;
  if (candidate.sellPrice !== null && existing.sellPrice === null) return candidate;
  if (candidate.hasSprite && !existing.hasSprite) return candidate;
  if (candidate.clientId !== null && existing.clientId === null) return candidate;
  if (candidate.hasSprite && existing.hasSprite && candidate.clientId !== null && existing.clientId === null) return candidate;
  return existing;
}

export const itemsByName: ReadonlyMap<string, Item> = (() => {
  const map = new Map<string, Item>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = map.get(key);
    map.set(key, existing ? preferItem(existing, item) : item);
  }
  return map;
})();
export const huntsById: ReadonlyMap<string, Hunt> = new Map(hunts.map((h) => [h.id, h]));
export const vocationsById: ReadonlyMap<number, Vocation> = new Map(vocations.map((v) => [v.id, v]));
export const wandsById: ReadonlyMap<number, WandStats> = new Map(wands.map((wand) => [wand.id, wand]));
export const outfitsCatalogById: ReadonlyMap<string, OutfitCatalogEntry> = new Map(
  outfitsCatalog.map((entry) => [entry.id, entry]),
);
export const mountsCatalogById: ReadonlyMap<string, MountCatalogEntry> = new Map(
  mountsCatalog.map((entry) => [entry.id, entry]),
);
export const mountsByServerId: ReadonlyMap<number, MountCatalogEntry> = new Map(
  mountsCatalog.map((entry) => [entry.mount, entry]),
);

/** The five vocations a player can start as, in the order the UI shows them. */
export const PLAYABLE_VOCATION_IDS = [4, 9, 3, 1, 2] as const;

export function getMonster(id: string): Monster {
  const monster = monstersById.get(id);
  if (!monster) throw new Error(`unknown monster: ${id}`);
  return monster;
}

export function getHunt(id: string): Hunt {
  const hunt = huntsById.get(id);
  if (!hunt) throw new Error(`unknown hunt: ${id}`);
  return hunt;
}

export function getVocation(id: number): Vocation {
  const vocation = vocationsById.get(id);
  if (!vocation) throw new Error(`unknown vocation: ${id}`);
  return vocation;
}
