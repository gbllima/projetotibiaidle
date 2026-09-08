import { spellEffect, spellShoot, type Spell } from '@tibia-idle/sim';
import type { CombatType } from '@tibia-idle/data';
import { magicEffectId } from './effects.js';
import MAGIC_EFFECTS from './magic-effects.json' with { type: 'json' };
import SHOOT_EFFECTS from './shoot-effects.json' with { type: 'json' };

const ME = MAGIC_EFFECTS as Record<string, number>;
const SHOOT = SHOOT_EFFECTS as Record<string, number>;

const BY_DAMAGE: Record<CombatType, number> = {
  COMBAT_PHYSICALDAMAGE: ME.DRAWBLOOD ?? 1,
  COMBAT_ENERGYDAMAGE: ME.ENERGYHIT ?? 12,
  COMBAT_EARTHDAMAGE: ME.HITBYPOISON ?? 17,
  COMBAT_FIREDAMAGE: ME.HITBYFIRE ?? 16,
  COMBAT_LIFEDRAIN: ME.MAGIC_RED ?? 14,
  COMBAT_MANADRAIN: ME.LOSEENERGY ?? 2,
  COMBAT_DROWNDAMAGE: ME.WATERSPLASH ?? 54,
  COMBAT_ICEDAMAGE: ME.ICEATTACK ?? 44,
  COMBAT_HOLYDAMAGE: ME.HOLYDAMAGE ?? 40,
  COMBAT_DEATHDAMAGE: ME.MORTAREA ?? 18,
  COMBAT_HEALING: ME.MAGIC_BLUE ?? 13,
};

interface SpellIconManifest {
  version: number;
  sheet: string;
  iconSize: number;
  iconsPerRow: number;
  icons: Record<string, number>;
}

interface SpriteGroup {
  sprites: number[];
}

interface AtlasMeta {
  atlas: { pages: string[]; frames: Record<string, [number, number, number, number, number]> };
  entries: Record<string, { groups: Record<string, SpriteGroup> }>;
}

const GROUP_ORDER = ['0', '1', '2'];
const ASSET_BUST = import.meta.env.DEV ? String(Date.now()) : '2';

const metaCache = new Map<string, Promise<AtlasMeta>>();
const pageCache = new Map<string, Promise<HTMLImageElement>>();
const iconCache = new Map<string, string>();

let manifestPromise: Promise<SpellIconManifest> | null = null;
let sheetPromise: Promise<HTMLImageElement> | null = null;

function loadManifest(): Promise<SpellIconManifest> {
  manifestPromise ??= fetch(`/assets/spell-icons.json?v=${ASSET_BUST}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => data ?? { version: 0, sheet: '', iconSize: 32, iconsPerRow: 20, icons: {} }) as Promise<SpellIconManifest>;
  return manifestPromise;
}

function loadSpellSheet(file: string): Promise<HTMLImageElement> {
  sheetPromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`spell sheet ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  return sheetPromise;
}

function loadMeta(category: 'effects' | 'missiles'): Promise<AtlasMeta> {
  const existing = metaCache.get(category);
  if (existing) return existing;
  const promise = fetch(`/assets/${category}.json?v=${ASSET_BUST}`).then((r) => r.json()) as Promise<AtlasMeta>;
  metaCache.set(category, promise);
  return promise;
}

function loadPage(file: string): Promise<HTMLImageElement> {
  const existing = pageCache.get(file);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`atlas page ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  pageCache.set(file, promise);
  return promise;
}

function pickSpriteId(entry: AtlasMeta['entries'][string], frames: AtlasMeta['atlas']['frames']): number | undefined {
  const groups = entry.groups;
  const orderedKeys = [
    ...GROUP_ORDER.filter((key) => groups[key]),
    ...Object.keys(groups).filter((key) => !GROUP_ORDER.includes(key)),
  ];
  for (const key of orderedKeys) {
    for (const spriteId of groups[key]?.sprites ?? []) {
      if (frames[String(spriteId)]) return spriteId;
    }
  }
  return undefined;
}

async function iconFromSheet(manifest: SpellIconManifest, iconIndex: number): Promise<string | null> {
  if (!manifest.sheet) return null;
  try {
    const image = await loadSpellSheet(manifest.sheet);
    const size = manifest.iconSize || 32;
    const perRow = manifest.iconsPerRow || 20;
    const col = iconIndex % perRow;
    const row = Math.floor(iconIndex / perRow);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, col * size, row * size, size, size, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function iconFromAtlas(category: 'effects' | 'missiles', appearanceId: number): Promise<string | null> {
  const meta = await loadMeta(category);
  const entry = meta.entries[String(appearanceId)];
  if (!entry) return null;
  const spriteId = pickSpriteId(entry, meta.atlas.frames);
  if (spriteId === undefined) return null;
  const frame = meta.atlas.frames[String(spriteId)];
  if (!frame) return null;
  const pageFile = meta.atlas.pages[frame[0]] ?? '';
  if (!pageFile) return null;
  try {
    const [, x, y, w, h] = frame;
    const image = await loadPage(pageFile);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x, y, w, h, 0, 0, 32, 32);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function shootId(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const key = name.startsWith('CONST_ANI_') ? name.slice('CONST_ANI_'.length) : name;
  return SHOOT[key];
}

function spellAppearance(spell: Spell): { category: 'effects' | 'missiles'; id: number } | null {
  const effect = spellEffect(spell);
  if (effect) {
    const id = magicEffectId(effect);
    if (id) return { category: 'effects', id };
  }
  const shoot = spellShoot(spell);
  const missileId = shootId(shoot);
  if (missileId) return { category: 'missiles', id: missileId };
  const fallback = BY_DAMAGE[spell.damageType];
  if (fallback) return { category: 'effects', id: fallback };
  return null;
}

/** Official Tibia spell-list icon (32×32 data URL), with combat-effect fallback. */
export async function spellIconUrl(spell: { id: string } & Partial<Spell>): Promise<string | null> {
  const cached = iconCache.get(spell.id);
  if (cached) return cached;

  const manifest = await loadManifest();
  const iconIndex = manifest.icons[spell.id];
  if (iconIndex !== undefined) {
    const official = await iconFromSheet(manifest, iconIndex);
    if (official) {
      iconCache.set(spell.id, official);
      return official;
    }
  }

  if (!spell.damageType) return null;

  const appearance = spellAppearance(spell as Spell);
  if (!appearance) return null;

  const url = await iconFromAtlas(appearance.category, appearance.id);
  if (url) iconCache.set(spell.id, url);
  return url;
}
