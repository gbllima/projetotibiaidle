interface SpriteGroup {
  patternWidth: number;
  patternHeight: number;
  layers: number;
  sprites: number[];
}

interface MountsMeta {
  atlas: { pages: string[]; frames: Record<string, [number, number, number, number, number]> };
  entries: Record<string, { groups: Record<string, SpriteGroup> }>;
}

const GROUP_IDLE = '0';
const DIRECTION_SOUTH = 2;
const ASSET_BUST = 'mounts-full-1';

let metaPromise: Promise<MountsMeta> | null = null;
const atlasPages = new Map<number, Promise<HTMLImageElement>>();
const cache = new Map<string, string>();

function loadMeta(): Promise<MountsMeta> {
  metaPromise ??= fetch(`/assets/mounts.json?v=${ASSET_BUST}`).then((r) => r.json()) as Promise<MountsMeta>;
  return metaPromise;
}

function loadAtlasPage(index: number, file: string): Promise<HTMLImageElement> {
  const existing = atlasPages.get(index);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`mount page ${file}`));
    image.src = `/assets/${file}?v=${ASSET_BUST}`;
  });
  atlasPages.set(index, promise);
  return promise;
}

function pickSpriteId(entry: MountsMeta['entries'][string], frames: MountsMeta['atlas']['frames']): number | undefined {
  const group = entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
  if (!group) return undefined;
  const layers = Math.max(1, group.layers);
  const index = DIRECTION_SOUTH * layers;
  const preferred = group.sprites[index] ?? group.sprites[0];
  if (preferred != null && frames[String(preferred)]) return preferred;
  for (const spriteId of group.sprites) {
    if (frames[String(spriteId)]) return spriteId;
  }
  return undefined;
}

/** Preview icon for a mount client lookType. */
export async function mountIconUrl(clientid: number, size = 56): Promise<string | null> {
  const cacheKey = `${clientid}:${size}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const meta = await loadMeta();
  const entry = meta.entries[String(clientid)];
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
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(size / w, size / h);
    const drawW = w * scale;
    const drawH = h * scale;
    ctx.drawImage(image, x, y, w, h, (size - drawW) / 2, size - drawH, drawW, drawH);
    const url = canvas.toDataURL('image/png');
    cache.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}
