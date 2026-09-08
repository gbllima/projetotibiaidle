import { tibiaColor } from './outfit.js';

interface SpriteGroup {
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  frames: number;
  sprites: number[];
}

interface OutfitsMeta {
  atlas: { pages: string[]; frames: Record<string, [number, number, number, number, number]> };
  entries: Record<string, { groups: Record<string, SpriteGroup> }>;
}

export type OutfitColors = { head: number; body: number; legs: number; feet: number };

const GROUP_IDLE = '0';
const DIRECTION_SOUTH = 2;
const ASSET_BUST = 'outfits-recolor-2';

let metaPromise: Promise<OutfitsMeta> | null = null;
const atlasPages = new Map<number, Promise<HTMLImageElement>>();
const cache = new Map<string, string>();

function loadMeta(): Promise<OutfitsMeta> {
  metaPromise ??= fetch(`/assets/outfits.json?v=${ASSET_BUST}`).then((r) => r.json()) as Promise<OutfitsMeta>;
  return metaPromise;
}

function loadAtlasPage(index: number, file: string): Promise<HTMLImageElement> {
  const existing = atlasPages.get(index);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`outfit page ${file}`));
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

async function cropSprite(
  meta: OutfitsMeta,
  spriteId: number,
): Promise<ImageData | null> {
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
  const head = tibiaColor(colors.head);
  const body = tibiaColor(colors.body);
  const legs = tibiaColor(colors.legs);
  const feet = tibiaColor(colors.feet);
  const palette = { head, body, legs, feet };

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

export async function outfitIconUrl(
  lookType: number,
  size = 48,
  colors?: OutfitColors | null,
  addon = 0,
  direction = DIRECTION_SOUTH,
  mounted = false,
): Promise<string | null> {
  const colorKey = colors
    ? `${colors.head}-${colors.body}-${colors.legs}-${colors.feet}`
    : 'plain';
  const dir = ((direction % 4) + 4) % 4;
  const mountIdx = mounted ? 1 : 0;
  const cacheKey = `${lookType}:${size}:${colorKey}:${addon}:d${dir}:m${mountIdx}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const meta = await loadMeta();
  const entry = meta.entries[String(lookType)];
  if (!entry) return null;

  const group = entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
  if (!group) return null;

  // Bitmask addons: compose base + selected addon rows (Global behaviour).
  const rows = [0];
  if (addon & 1) rows.push(1);
  if (addon & 2) rows.push(2);
  const uniqueRows = [...new Set(rows)].filter((row) => row < Math.max(1, group.patternHeight));

  try {
    let composed: ImageData | null = null;
    for (const row of uniqueRows) {
      const baseId = group.sprites[spriteIndex(group, dir, 0, row, mountIdx)]
        ?? group.sprites[spriteIndex(group, DIRECTION_SOUTH, 0, row, mountIdx)]
        ?? (row === 0 ? group.sprites[mountIdx * group.patternHeight * group.patternWidth] : undefined);
      if (baseId == null) continue;
      const base = await cropSprite(meta, baseId);
      if (!base) continue;

      let layer = base;
      if (colors && group.layers > 1) {
        const maskId = group.sprites[spriteIndex(group, dir, 1, row, mountIdx)]
          ?? group.sprites[spriteIndex(group, DIRECTION_SOUTH, 1, row, mountIdx)];
        const mask = maskId != null ? await cropSprite(meta, maskId) : null;
        layer = applyRecolor(base, mask, colors);
      }

      if (!composed) {
        composed = new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height);
      } else {
        const dst = composed.data;
        const src = layer.data;
        const dw = composed.width;
        const dh = composed.height;
        const sw = layer.width;
        const sh = layer.height;
        const ox = Math.floor((dw - sw) / 2);
        const oy = Math.floor((dh - sh) / 2);
        for (let y = 0; y < sh; y += 1) {
          for (let x = 0; x < sw; x += 1) {
            const si = (y * sw + x) * 4;
            if (src[si + 3]! < 8) continue;
            const dx = x + ox;
            const dy = y + oy;
            if (dx < 0 || dy < 0 || dx >= dw || dy >= dh) continue;
            const di = (dy * dw + dx) * 4;
            dst[di] = src[si]!;
            dst[di + 1] = src[si + 1]!;
            dst[di + 2] = src[si + 2]!;
            dst[di + 3] = src[si + 3]!;
          }
        }
      }
    }
    if (!composed) return null;

    const canvas = document.createElement('canvas');
    canvas.width = composed.width;
    canvas.height = composed.height;
    canvas.getContext('2d')?.putImageData(composed, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    const fitted = await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const ctx = out.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.imageSmoothingEnabled = false;
        const scale = Math.min(size / img.width, size / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        ctx.drawImage(img, (size - drawW) / 2, size - drawH, drawW, drawH);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

    cache.set(cacheKey, fitted);
    return fitted;
  } catch {
    return null;
  }
}
