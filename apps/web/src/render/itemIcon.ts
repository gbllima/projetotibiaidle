import { itemsById } from '@tibia-idle/data';

interface SpriteGroup {
  sprites: number[];
}

interface ItemsMeta {
  atlas: { pages: string[]; frames: Record<string, [number, number, number, number, number]> };
  entries: Record<string, { groups: Record<string, SpriteGroup> }>;
}

interface IconManifest {
  [itemId: string]: { clientId?: number; file: string; name?: string };
}

const GROUP_ORDER = ['0', '1', '2'];
const ASSET_BUST = import.meta.env.DEV ? String(Date.now()) : '2';

let metaPromise: Promise<ItemsMeta> | null = null;
let manifestPromise: Promise<IconManifest> | null = null;
const atlasPages = new Map<number, Promise<HTMLImageElement>>();
const standaloneIcons = new Map<string, Promise<HTMLImageElement>>();
const cache = new Map<number, string>();

function loadMeta(): Promise<ItemsMeta> {
  metaPromise ??= fetch(`/assets/items.json?v=${ASSET_BUST}`).then((r) => r.json()) as Promise<ItemsMeta>;
  return metaPromise;
}

function loadManifest(): Promise<IconManifest> {
  manifestPromise ??= fetch(`/assets/item-icons.json?v=${ASSET_BUST}`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})) as Promise<IconManifest>;
  return manifestPromise;
}

function loadAtlasPage(index: number, file: string): Promise<HTMLImageElement> {
  const existing = atlasPages.get(index);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`item page ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  atlasPages.set(index, promise);
  return promise;
}

function loadStandaloneIcon(file: string): Promise<HTMLImageElement> {
  const existing = standaloneIcons.get(file);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`icon ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  standaloneIcons.set(file, promise);
  return promise;
}

function pickSpriteId(entry: ItemsMeta['entries'][string], frames: ItemsMeta['atlas']['frames']): number | undefined {
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

async function toDataUrl(image: CanvasImageSource): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, 32, 32);
  return canvas.toDataURL('image/png');
}

async function iconFromAtlas(meta: ItemsMeta, appearanceId: number, itemId: number): Promise<string | null> {
  const entry = meta.entries[String(appearanceId)] ?? meta.entries[String(itemId)];
  if (!entry) return null;
  const spriteId = pickSpriteId(entry, meta.atlas.frames);
  if (spriteId === undefined) return null;
  const frame = meta.atlas.frames[String(spriteId)];
  if (!frame) return null;
  const pageFile = meta.atlas.pages[frame[0]] ?? '';
  if (!pageFile) return null;
  try {
    const [page, x, y, w, h] = frame;
    const image = await loadAtlasPage(page, pageFile);
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

async function iconFromManifest(itemId: number): Promise<string | null> {
  const manifest = await loadManifest();
  const row = manifest[String(itemId)];
  if (!row?.file) return null;
  try {
    const image = await loadStandaloneIcon(row.file);
    return toDataUrl(image);
  } catch {
    return null;
  }
}

export async function itemIconUrl(itemId: number): Promise<string | null> {
  const cached = cache.get(itemId);
  if (cached) return cached;

  const item = itemsById.get(itemId);
  const appearanceId = item?.clientId ?? itemId;
  const meta = await loadMeta();

  const atlasUrl = await iconFromAtlas(meta, appearanceId, itemId);
  if (atlasUrl) {
    cache.set(itemId, atlasUrl);
    return atlasUrl;
  }

  const manifestUrl = await iconFromManifest(itemId);
  if (manifestUrl) {
    cache.set(itemId, manifestUrl);
    return manifestUrl;
  }

  return null;
}
