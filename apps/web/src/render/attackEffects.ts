import { Assets, Rectangle, Texture } from 'pixi.js';
import type { AttackEffectKey } from '@tibia-idle/sim';

interface AttackMeta {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  animationSpeed: number;
  sprites: Record<string, string>;
}

const BASE = '/assets/attack';
const BUST = 'melee-fx-2';

let metaPromise: Promise<AttackMeta> | null = null;
const frameCache = new Map<string, Texture[]>();

function loadMeta(): Promise<AttackMeta> {
  metaPromise ??= fetch(`${BASE}/attack-effects.json?v=${BUST}`, { cache: 'no-store' })
    .then((r) => r.json()) as Promise<AttackMeta>;
  return metaPromise;
}

/** Animated slash frames for knight / monk weapon types. */
export async function loadAttackFrames(key: AttackEffectKey | string): Promise<Texture[]> {
  const cached = frameCache.get(key);
  if (cached?.length && !cached[0]?.destroyed) return cached;

  const meta = await loadMeta();
  const file = meta.sprites[key];
  if (!file) return [];

  const strip = await Assets.load<Texture>(`${BASE}/${file}?v=${BUST}`);
  if (!strip || strip.destroyed) return [];

  const textures: Texture[] = [];
  for (let i = 0; i < meta.frameCount; i += 1) {
    textures.push(new Texture({
      source: strip.source,
      frame: new Rectangle(i * meta.frameWidth, 0, meta.frameWidth, meta.frameHeight),
    }));
  }
  frameCache.set(key, textures);
  return textures;
}

export async function attackAnimationSpeed(): Promise<number> {
  const meta = await loadMeta();
  return meta.animationSpeed ?? 0.32;
}

/** Warm all melee swing strips so the first auto-attack does not hitch. */
export async function preloadAttackFrames(): Promise<void> {
  const meta = await loadMeta();
  await Promise.all(Object.keys(meta.sprites).map((key) => loadAttackFrames(key)));
}
