import { Assets, Texture } from 'pixi.js';

const ASSET_BUST = import.meta.env.DEV ? '3' : '3';

interface SceneRow {
  file: string;
  width?: number;
  height?: number;
  name?: string;
}

interface IconRow {
  file: string;
}

let sceneManifestPromise: Promise<Record<string, SceneRow>> | null = null;
let iconManifestPromise: Promise<Record<string, IconRow>> | null = null;
const cache = new Map<number, Texture>();
const loading = new Map<number, Promise<Texture>>();

function loadSceneManifest(): Promise<Record<string, SceneRow>> {
  sceneManifestPromise ??= fetch(`/assets/item-scenes.json?v=${ASSET_BUST}`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})) as Promise<Record<string, SceneRow>>;
  return sceneManifestPromise;
}

function loadIconManifest(): Promise<Record<string, IconRow>> {
  iconManifestPromise ??= fetch(`/assets/item-icons.json?v=${ASSET_BUST}`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})) as Promise<Record<string, IconRow>>;
  return iconManifestPromise;
}

function placeholder(color: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(16, 16, 32, 40);
  }
  return Texture.from(canvas);
}

function textureFromImage(image: HTMLImageElement): Texture {
  return Texture.from(image);
}

async function loadFromUrl(url: string): Promise<Texture | null> {
  const isData = url.startsWith('data:');
  const src = isData
    ? url
    : (url.includes('?') ? `${url}&v=${ASSET_BUST}` : `${url}?v=${ASSET_BUST}`);

  if (!isData) {
    try {
      const tex = await Assets.load<Texture>(src);
      if (tex && tex.width > 0 && tex.height > 0) return tex;
    } catch {
      /* fall through */
    }
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(textureFromImage(image));
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** Full-resolution scene sprite (training dummies, house items). */
export async function itemSceneTexture(itemId: number): Promise<Texture> {
  const cached = cache.get(itemId);
  if (cached && !cached.destroyed && cached.width > 1) return cached;

  const pending = loading.get(itemId);
  if (pending) return pending;

  const promise = (async () => {
    const sceneManifest = await loadSceneManifest();
    const sceneRow = sceneManifest[String(itemId)];
    if (sceneRow?.file) {
      const tex = await loadFromUrl(`/assets/${sceneRow.file}`);
      if (tex && tex.width > 0) {
        cache.set(itemId, tex);
        return tex;
      }
    }

    const iconManifest = await loadIconManifest();
    const iconRow = iconManifest[String(itemId)];
    if (iconRow?.file) {
      const tex = await loadFromUrl(`/assets/${iconRow.file}`);
      if (tex && tex.width > 0) {
        cache.set(itemId, tex);
        return tex;
      }
    }

    const { itemIconUrl } = await import('./itemIcon.js');
    const dataUrl = await itemIconUrl(itemId);
    if (dataUrl) {
      const tex = await loadFromUrl(dataUrl);
      if (tex && tex.width > 0) {
        cache.set(itemId, tex);
        return tex;
      }
    }

    const fallback = placeholder(0x6b4a2a);
    cache.set(itemId, fallback);
    return fallback;
  })();

  loading.set(itemId, promise);
  try {
    return await promise;
  } finally {
    loading.delete(itemId);
  }
}

/** @deprecated Use itemSceneTexture for in-world props. */
export const itemTexture = itemSceneTexture;
