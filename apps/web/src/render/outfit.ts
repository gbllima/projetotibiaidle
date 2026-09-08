import { Texture } from 'pixi.js';
import { DIRECTION_SOUTH, GROUP_IDLE, GROUP_MOVING, type Atlas } from './atlas.js';

const HSI_SI_VALUES = 7;
const HSI_H_STEPS = 19;

/** Official Tibia 133-color HSI palette (OTClient Outfit::getColor). */
export function tibiaColor(index: number): [number, number, number] {
  let color = Math.floor(index);
  if (color < 0 || color >= HSI_H_STEPS * HSI_SI_VALUES) color = 0;

  let loc1 = 0;
  let loc2 = 0;
  let loc3 = 0;
  if (color % HSI_H_STEPS !== 0) {
    loc1 = (color % HSI_H_STEPS) / 18;
    loc2 = 1;
    loc3 = 1;
    switch (Math.floor(color / HSI_H_STEPS)) {
      case 0: loc2 = 0.25; loc3 = 1; break;
      case 1: loc2 = 0.25; loc3 = 0.75; break;
      case 2: loc2 = 0.5; loc3 = 0.75; break;
      case 3: loc2 = 0.667; loc3 = 0.75; break;
      case 4: loc2 = 1; loc3 = 1; break;
      case 5: loc2 = 1; loc3 = 0.75; break;
      case 6: loc2 = 1; loc3 = 0.5; break;
      default: break;
    }
  } else {
    loc1 = 0;
    loc2 = 0;
    loc3 = 1 - color / HSI_H_STEPS / HSI_SI_VALUES;
  }

  if (loc3 === 0) return [0, 0, 0];
  if (loc2 === 0) {
    const gray = Math.round(loc3 * 255);
    return [gray, gray, gray];
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  if (loc1 < 1 / 6) {
    red = loc3;
    blue = loc3 * (1 - loc2);
    green = blue + (loc3 - blue) * 6 * loc1;
  } else if (loc1 < 2 / 6) {
    green = loc3;
    blue = loc3 * (1 - loc2);
    red = green - (loc3 - blue) * (6 * loc1 - 1);
  } else if (loc1 < 3 / 6) {
    green = loc3;
    red = loc3 * (1 - loc2);
    blue = red + (loc3 - red) * (6 * loc1 - 2);
  } else if (loc1 < 4 / 6) {
    blue = loc3;
    red = loc3 * (1 - loc2);
    green = blue - (loc3 - red) * (6 * loc1 - 3);
  } else if (loc1 < 5 / 6) {
    blue = loc3;
    green = loc3 * (1 - loc2);
    red = green + (loc3 - green) * (6 * loc1 - 4);
  } else {
    red = loc3;
    green = loc3 * (1 - loc2);
    blue = red - (loc3 - green) * (6 * loc1 - 5);
  }
  return [Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255)];
}

export function tibiaColorCss(index: number): string {
  const [r, g, b] = tibiaColor(index);
  return `rgb(${r},${g},${b})`;
}

function tintFromMask(r: number, g: number, b: number, colors: {
  head: [number, number, number];
  body: [number, number, number];
  legs: [number, number, number];
  feet: [number, number, number];
}): [number, number, number] | null {
  // Template mask: yellow=head, red=body, green=legs, blue=feet.
  if (r > 80 && g > 80 && b < 80) return colors.head;
  if (r > 80 && g < 80 && b < 80) return colors.body;
  if (g > 80 && r < 80 && b < 80) return colors.legs;
  if (b > 80 && r < 80 && g < 80) return colors.feet;
  return null;
}

function drawTexture(texture: Texture): ImageData | null {
  const frame = texture.frame;
  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (!resource || frame.width <= 0 || frame.height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(resource, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return ctx.getImageData(0, 0, frame.width, frame.height);
}

/** Multiply template pixels by outfit colors using the color mask layer. */
function recolorImageData(
  base: ImageData,
  mask: ImageData | null,
  colors: {
    head: [number, number, number];
    body: [number, number, number];
    legs: [number, number, number];
    feet: [number, number, number];
  },
): ImageData {
  const pixels = new Uint8ClampedArray(base.data);
  if (mask && mask.data.length === pixels.length) {
    const marks = mask.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 8) continue;
      const tint = tintFromMask(marks[i]!, marks[i + 1]!, marks[i + 2]!, colors);
      if (!tint) continue;
      // Template greys are typically ~180; scale chosen color by pixel brightness.
      const brightness = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / (3 * 255);
      pixels[i] = Math.min(255, Math.round(tint[0] * brightness * 1.35));
      pixels[i + 1] = Math.min(255, Math.round(tint[1] * brightness * 1.35));
      pixels[i + 2] = Math.min(255, Math.round(tint[2] * brightness * 1.35));
    }
  }
  return new ImageData(pixels, base.width, base.height);
}

function imageDataToTexture(data: ImageData): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')?.putImageData(data, 0, 0);
  return Texture.from(canvas);
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

/** Addon bitmask 0–3 → pattern rows to draw (base + optional overlays). */
export function addonPatternRows(addons = 0, patternHeight = 3): number[] {
  const bits = Math.max(0, Math.min(3, Math.floor(addons)));
  const maxRow = Math.max(1, patternHeight);
  const rows = [0];
  if ((bits & 1) && 1 < maxRow) rows.push(1);
  if ((bits & 2) && 2 < maxRow) rows.push(2);
  return rows;
}

function patternHeightOf(atlas: Atlas, lookType: number, groupName: string): number {
  const entry = atlas.entry(lookType);
  if (!entry) return 1;
  const group = entry.groups[groupName] ?? entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
  return Math.max(1, group?.patternHeight ?? 1);
}

function layerCountOf(atlas: Atlas, lookType: number, groupName: string): number {
  const entry = atlas.entry(lookType);
  if (!entry) return 1;
  const group = entry.groups[groupName] ?? entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
  return Math.max(1, group?.layers ?? 1);
}

/**
 * Build animated frames for an outfit: always draw base, then addon overlays,
 * recolored with the 133-color HSI palette.
 */
export function recoloredFrames(
  atlas: Atlas,
  lookType: number,
  appearance: { head: number; body: number; legs: number; feet: number; addons?: number },
  direction = DIRECTION_SOUTH,
  group = GROUP_MOVING,
  options?: { mounted?: boolean },
): Texture[] {
  const mountIdx = options?.mounted ? 1 : 0;
  const colors = {
    head: tibiaColor(appearance.head),
    body: tibiaColor(appearance.body),
    legs: tibiaColor(appearance.legs),
    feet: tibiaColor(appearance.feet),
  };

  const height = patternHeightOf(atlas, lookType, group);
  const layers = layerCountOf(atlas, lookType, group);
  const rows = addonPatternRows(appearance.addons ?? 0, height);

  const baseLayer = atlas.frames(lookType, { group, direction, layer: 0, addon: 0, mount: mountIdx });
  const idleFallback = baseLayer.textures.length
    ? baseLayer
    : atlas.frames(lookType, { group: GROUP_IDLE, direction, layer: 0, addon: 0, mount: mountIdx });
  const phases = idleFallback.textures.length
    ? idleFallback
    : atlas.frames(lookType, { direction, layer: 0, addon: 0, mount: mountIdx });
  if (!phases.textures.length) return [];

  const out: Texture[] = [];
  for (let phase = 0; phase < phases.textures.length; phase += 1) {
    let composed: ImageData | null = null;

    for (const row of rows) {
      const useGroup = group;
      let baseTex = atlas.frames(lookType, { group: useGroup, direction, layer: 0, addon: row, mount: mountIdx }).textures[phase];
      let maskTex = layers > 1
        ? atlas.frames(lookType, { group: useGroup, direction, layer: 1, addon: row, mount: mountIdx }).textures[phase]
        : undefined;
      if (!baseTex) {
        baseTex = atlas.frames(lookType, { group: GROUP_IDLE, direction, layer: 0, addon: row, mount: mountIdx }).textures[phase]
          ?? atlas.frames(lookType, { direction, layer: 0, addon: row, mount: mountIdx }).textures[phase];
        if (layers > 1) {
          maskTex = atlas.frames(lookType, { group: GROUP_IDLE, direction, layer: 1, addon: row, mount: mountIdx }).textures[phase]
            ?? atlas.frames(lookType, { direction, layer: 1, addon: row, mount: mountIdx }).textures[phase];
        }
      }
      if (!baseTex) continue;

      const base = drawTexture(baseTex);
      if (!base) continue;
      const mask = maskTex ? drawTexture(maskTex) : null;
      const tinted = recolorImageData(base, mask, colors);

      if (!composed) {
        composed = new ImageData(new Uint8ClampedArray(tinted.data), tinted.width, tinted.height);
      } else {
        blitOpaque(composed, tinted);
      }
    }

    if (composed) out.push(imageDataToTexture(composed));
  }

  return out;
}

/** Only humanoid/template creatures (2+ sprite layers) need HSI recolor. */
export function creatureRecolorAppearance(
  atlas: Atlas | null | undefined,
  lookType: number,
  outfit: Record<string, number> | null | undefined,
): ReturnType<typeof outfitToAppearance> | undefined {
  if (!atlas || !lookType || !outfit) return undefined;
  if (layerCountOf(atlas, lookType, GROUP_MOVING) < 2 && layerCountOf(atlas, lookType, GROUP_IDLE) < 2) {
    return undefined;
  }
  return outfitToAppearance(outfit);
}

/** Monster Lua `outfit` table → combat appearance (head/body/legs/feet/addons). */
export function outfitToAppearance(outfit: Record<string, number>): {
  outfit: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
} {
  return {
    outfit: outfit.lookType ?? 0,
    head: outfit.lookHead ?? 0,
    body: outfit.lookBody ?? 0,
    legs: outfit.lookLegs ?? 0,
    feet: outfit.lookFeet ?? 0,
    addons: outfit.lookAddons ?? 0,
    mount: outfit.lookMount ?? 0,
  };
}

/** Stable key so combat can detect outfit/color/addon changes. */
export function appearancePoseKey(
  appearance?: { outfit?: number; head?: number; body?: number; legs?: number; feet?: number; addons?: number; mount?: number } | null,
): string {
  if (!appearance) return '';
  return [
    appearance.outfit ?? 0,
    appearance.head ?? 0,
    appearance.body ?? 0,
    appearance.legs ?? 0,
    appearance.feet ?? 0,
    appearance.addons ?? 0,
    appearance.mount ?? 0,
  ].join(':');
}
