import { monstersById } from '@tibia-idle/data';
import { tibiaColor } from './outfit.js';
import type { OutfitColors } from './outfitIcon.js';

interface SpriteGroup {
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  frames: number;
  sprites: number[];
}

interface CreaturesMeta {
  atlas: { pages: string[]; frames: Record<string, [number, number, number, number, number]> };
  entries: Record<string, { groups: Record<string, SpriteGroup> }>;
}

const GROUP_IDLE = '0';
const DIRECTION_SOUTH = 2;
const ASSET_BUST = import.meta.env.DEV ? String(Date.now()) : '3';

let metaPromise: Promise<CreaturesMeta> | null = null;
const atlasPages = new Map<number, Promise<HTMLImageElement>>();
const cache = new Map<string, string>();

function loadMeta(): Promise<CreaturesMeta> {
  metaPromise ??= fetch(`/assets/creatures.json?v=${ASSET_BUST}`).then((r) => r.json()) as Promise<CreaturesMeta>;
  return metaPromise;
}

function loadAtlasPage(index: number, file: string): Promise<HTMLImageElement> {
  const existing = atlasPages.get(index);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`creature page ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  atlasPages.set(index, promise);
  return promise;
}

function spriteIndex(
  group: SpriteGroup,
  direction: number,
  layer: number,
  addon = 0,
  mount = 0,
): number {
  const dir = direction % Math.max(1, group.patternWidth);
  const add = addon % Math.max(1, group.patternHeight);
  const depth = mount % Math.max(1, group.patternDepth);
  const lay = layer % Math.max(1, group.layers);
  return (((depth * group.patternHeight + add) * group.patternWidth + dir) * group.layers) + lay;
}

function tintFromMask(r: number, g: number, b: number, colors: {
  head: [number, number, number];
  body: [number, number, number];
  legs: [number, number, number];
  feet: [number, number, number];
}): [number, number, number] | null {
  if (r > 80 && g > 80 && b < 80) return colors.head;
  if (r > 80 && g < 80 && b < 80) return colors.body;
  if (g > 80 && r < 80 && b < 80) return colors.legs;
  if (b > 80 && r < 80 && g < 80) return colors.feet;
  return null;
}

async function cropSprite(meta: CreaturesMeta, spriteId: number): Promise<ImageData | null> {
  const frame = meta.atlas.frames[String(spriteId)];
  if (!frame) return null;
  const pageFile = meta.atlas.pages[frame[0]] ?? '';
  if (!pageFile) return null;
  const [page, x, y, w, h] = frame;
  const image = await loadAtlasPage(page, pageFile);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function applyRecolor(base: ImageData, mask: ImageData | null, colors: OutfitColors): ImageData {
  const palette = {
    head: tibiaColor(colors.head),
    body: tibiaColor(colors.body),
    legs: tibiaColor(colors.legs),
    feet: tibiaColor(colors.feet),
  };
  const pixels = new Uint8ClampedArray(base.data);
  if (mask && mask.data.length === pixels.length) {
    const marks = mask.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 8) continue;
      const tint = tintFromMask(marks[i]!, marks[i + 1]!, marks[i + 2]!, palette);
      if (!tint) continue;
      const brightness = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / (3 * 255);
      pixels[i] = Math.min(255, Math.round(tint[0] * brightness * 1.35));
      pixels[i + 1] = Math.min(255, Math.round(tint[1] * brightness * 1.35));
      pixels[i + 2] = Math.min(255, Math.round(tint[2] * brightness * 1.35));
    }
  }
  return new ImageData(pixels, base.width, base.height);
}

function blitOpaque(dst: ImageData, src: ImageData): void {
  const dw = dst.width;
  const dh = dst.height;
  const sw = src.width;
  const sh = src.height;
  const ox = Math.floor((dw - sw) / 2);
  const oy = Math.floor((dh - sh) / 2);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const si = (y * sw + x) * 4;
      if (src.data[si + 3]! < 8) continue;
      const dx = x + ox;
      const dy = y + oy;
      if (dx < 0 || dy < 0 || dx >= dw || dy >= dh) continue;
      const di = (dy * dw + dx) * 4;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = src.data[si + 3]!;
    }
  }
}

async function iconFromLookType(
  lookType: number,
  size: number,
  colors?: OutfitColors | null,
  addon = 0,
): Promise<string | null> {
  const colorKey = colors
    ? `${colors.head}-${colors.body}-${colors.legs}-${colors.feet}`
    : 'plain';
  const cacheKey = `${lookType}:${size}:${colorKey}:${addon}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const meta = await loadMeta();
  const entry = meta.entries[String(lookType)];
  if (!entry) return null;

  const group = entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
  if (!group) return null;

  const rows = [0];
  if (addon & 1) rows.push(1);
  if (addon & 2) rows.push(2);
  const uniqueRows = [...new Set(rows)].filter((row) => row < Math.max(1, group.patternHeight));

  try {
    let composed: ImageData | null = null;
    for (const row of uniqueRows) {
      const baseId = group.sprites[spriteIndex(group, DIRECTION_SOUTH, 0, row)]
        ?? group.sprites[0];
      if (baseId == null) continue;
      const base = await cropSprite(meta, baseId);
      if (!base) continue;

      let layer = base;
      if (colors && group.layers > 1) {
        const maskId = group.sprites[spriteIndex(group, DIRECTION_SOUTH, 1, row)];
        const mask = maskId != null ? await cropSprite(meta, maskId) : null;
        layer = applyRecolor(base, mask, colors);
      }

      if (!composed) {
        composed = new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height);
      } else {
        blitOpaque(composed, layer);
      }
    }
    if (!composed) return null;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    const temp = document.createElement('canvas');
    temp.width = composed.width;
    temp.height = composed.height;
    temp.getContext('2d')?.putImageData(composed, 0, 0);

    const scale = Math.min(size / composed.width, size / composed.height);
    const drawW = composed.width * scale;
    const drawH = composed.height * scale;
    ctx.drawImage(temp, (size - drawW) / 2, size - drawH, drawW, drawH);
    const url = canvas.toDataURL('image/png');
    cache.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

export function monsterLookType(monsterId: string): number | null {
  const monster = monstersById.get(monsterId);
  if (!monster) return null;
  return monster.outfit?.lookType ?? monster.lookType ?? null;
}

function monsterColors(monsterId: string): OutfitColors | null {
  const outfit = monstersById.get(monsterId)?.outfit;
  if (!outfit) return null;
  return {
    head: outfit.lookHead ?? 0,
    body: outfit.lookBody ?? 0,
    legs: outfit.lookLegs ?? 0,
    feet: outfit.lookFeet ?? 0,
  };
}

export async function creatureIconUrl(monsterId: string, size = 48): Promise<string | null> {
  const lookType = monsterLookType(monsterId);
  if (lookType == null) return null;
  const outfit = monstersById.get(monsterId)?.outfit;
  return iconFromLookType(lookType, size, monsterColors(monsterId), outfit?.lookAddons ?? 0);
}

export async function creatureIconUrlByLookType(lookType: number, size = 48): Promise<string | null> {
  return iconFromLookType(lookType, size);
}
