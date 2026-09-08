import { Assets, Rectangle, Texture } from 'pixi.js';

/**
 * Reading the extractor's atlases.
 *
 * The metadata keeps the complete `SpriteInfo` for every appearance - all
 * pattern dimensions and the full sprite list - even though only some
 * directions were packed. That means the OTClient index formula works here
 * unchanged, and widening the extractor's scope later changes only which
 * frames exist, never how they are addressed.
 */

export type AssetCategory = 'creatures' | 'items' | 'effects' | 'missiles' | 'outfits' | 'mounts' | 'tiles';

/** [page, x, y, width, height] */
type Frame = [number, number, number, number, number];

export interface SpriteGroup {
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  frames: number;
  /** Per-phase [minMs, maxMs]. */
  phases: [number, number][];
  sprites: number[];
}

export interface AppearanceEntry {
  name?: string;
  groups: Record<string, SpriteGroup>;
}

interface AtlasMeta {
  version: number;
  category: AssetCategory;
  directions: number[];
  atlas: { pages: string[]; pageSize: number; frames: Record<string, Frame> };
  entries: Record<string, AppearanceEntry>;
}

/** Idle, moving, and ground (tiles) are the groups the extractor packs. */
export const GROUP_IDLE = '0';
export const GROUP_MOVING = '1';
export const GROUP_GROUND = '2';

export const DIRECTION_NORTH = 0;
export const DIRECTION_EAST = 1;
/** 0 = north, 1 = east, 2 = south, 3 = west. */
export const DIRECTION_SOUTH = 2;
export const DIRECTION_WEST = 3;

const BASE = '/assets';

function applyPixelArtSampling(texture: Texture | null): void {
  if (!texture?.source || texture.source.destroyed) return;
  texture.source.scaleMode = 'nearest';
}

export class Atlas {
  private readonly pages: (Texture | null)[];
  private readonly textures = new Map<number, Texture>();

  private constructor(private readonly meta: AtlasMeta, pages: (Texture | null)[]) {
    this.pages = pages;
  }

  static async load(category: AssetCategory): Promise<Atlas> {
    // Bust stale browser caches after atlas regenerations (old tiles.json left
    // OTBM rooms black because ground ids were missing from the cached meta).
    const meta = (await fetch(`${BASE}/${category}.json`, { cache: 'no-store' }).then((r) =>
      r.json(),
    )) as AtlasMeta;
    const bust = `${meta.atlas.pages.length}-${Object.keys(meta.entries).length}`;
    const pages = await Promise.all(
      meta.atlas.pages.map((page) =>
        Assets.load<Texture>({
          src: `${BASE}/${page}?v=${bust}`,
          data: { scaleMode: 'nearest' },
        }).catch(() => null),
      ),
    );
    for (const page of pages) applyPixelArtSampling(page);
    return new Atlas(meta, pages);
  }

  get category(): AssetCategory {
    return this.meta.category;
  }

  entry(id: number): AppearanceEntry | undefined {
    return this.meta.entries[String(id)];
  }

  has(id: number): boolean {
    return this.meta.entries[String(id)] !== undefined;
  }

  /** A single packed sprite, or null when it was not packed. */
  texture(spriteId: number): Texture | null {
    const cached = this.textures.get(spriteId);
    if (cached && !cached.destroyed && !cached.source.destroyed) return cached;
    if (cached) this.textures.delete(spriteId);

    const frame = this.meta.atlas.frames[String(spriteId)];
    if (!frame) return null;
    const [page, x, y, width, height] = frame;
    const source = this.pages[page];
    if (!source || source.destroyed || source.source.destroyed) return null;

    const texture = new Texture({
      source: source.source,
      frame: new Rectangle(x, y, width, height),
    });
    applyPixelArtSampling(texture);
    this.textures.set(spriteId, texture);
    return texture;
  }

  /**
   * Index into a group's sprite list.
   *
   * ((((phase x depth + mount) x height + addon) x width + direction) x layers + layer)
   */
  spriteIndex(
    group: SpriteGroup,
    options: { phase?: number; direction?: number; addon?: number; mount?: number; layer?: number } = {},
  ): number {
    const phase = (options.phase ?? 0) % Math.max(1, group.frames);
    const direction = (options.direction ?? 0) % Math.max(1, group.patternWidth);
    const addon = (options.addon ?? 0) % Math.max(1, group.patternHeight);
    const mount = (options.mount ?? 0) % Math.max(1, group.patternDepth);
    const layer = (options.layer ?? 0) % Math.max(1, group.layers);

    return (
      (((phase * group.patternDepth + mount) * group.patternHeight + addon) * group.patternWidth +
        direction) *
        group.layers +
      layer
    );
  }

  /** Every phase of one direction, ready to hand to an AnimatedSprite. */
  frames(
    id: number,
    options: { group?: string; direction?: number; addon?: number; mount?: number; layer?: number } = {},
  ): { textures: Texture[]; durations: number[] } {
    const entry = this.entry(id);
    const empty = { textures: [] as Texture[], durations: [] as number[] };
    if (!entry) return empty;

    const group =
      entry.groups[options.group ?? GROUP_IDLE] ??
      entry.groups[GROUP_IDLE] ??
      entry.groups[GROUP_GROUND] ??
      Object.values(entry.groups)[0];
    if (!group) return empty;

    const textures: Texture[] = [];
    const durations: number[] = [];
    for (let phase = 0; phase < Math.max(1, group.frames); phase += 1) {
      const index = this.spriteIndex(group, {
        phase,
        direction: options.direction,
        addon: options.addon,
        mount: options.mount,
        layer: options.layer,
      });
      const texture = this.texture(group.sprites[index] ?? -1);
      if (!texture) continue;
      textures.push(texture);
      // A missing phase table means a static appearance; 200 ms keeps anything
      // that turns out to be animated from strobing.
      const phaseTiming = group.phases[phase];
      durations.push(phaseTiming ? (phaseTiming[0] + phaseTiming[1]) / 2 : 200);
    }
    if (!textures.length) {
      const any = this.icon(id, options.direction ?? DIRECTION_SOUTH);
      if (any) return { textures: [any], durations: [200] };
    }
    return textures.length ? { textures, durations } : empty;
  }

  /** Best single texture for an appearance, for lists and inventory slots. */
  icon(id: number, direction = DIRECTION_SOUTH): Texture | null {
    const entry = this.entry(id);
    if (!entry) return null;
    const group = entry.groups[GROUP_IDLE] ?? Object.values(entry.groups)[0];
    if (!group) return null;

    const direct = this.texture(group.sprites[this.spriteIndex(group, { direction })] ?? -1);
    if (direct) return direct;
    // Items are packed without direction variants, and creature scope may not
    // include the direction asked for; any packed frame beats a blank slot.
    for (const spriteId of group.sprites) {
      const texture = this.texture(spriteId);
      if (texture) return texture;
    }
    return null;
  }
}

const loading = new Map<AssetCategory, Promise<Atlas>>();

/** Atlases are large and immutable, so each category loads at most once. */
export function loadAtlas(category: AssetCategory): Promise<Atlas> {
  const existing = loading.get(category);
  if (existing) return existing;
  const promise = Atlas.load(category);
  loading.set(category, promise);
  return promise;
}
