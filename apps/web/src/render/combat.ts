import { CITY_WIDTH, CITY_HEIGHT, CITY_SPAWN, cityPath, cityWalkable, type CityPosition } from '@tibia-idle/data';
import { AnimatedSprite, Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { itemsById, monstersById, mountsByServerId } from '@tibia-idle/data';
import type { SimEvent } from '@tibia-idle/sim';
import type { ActiveMonsterView } from '../api/types.js';
import { DIRECTION_NORTH, DIRECTION_SOUTH, DIRECTION_WEST, GROUP_IDLE, GROUP_MOVING, loadAtlas, type Atlas } from './atlas.js';
import { attackAnimationSpeed, loadAttackFrames, preloadAttackFrames } from './attackEffects.js';
import { burstsFor, damageTint, isCustomMeleeSwing, magicEffectId, outgoingDamageTint } from './effects.js';
import { missileAim, shootEffectId } from './missiles.js';
import { recoloredFrames, appearancePoseKey, creatureRecolorAppearance } from './outfit.js';
import { paintCityScene, paintDecorations, paintHuntScene } from './scenes.js';
import {
  chebyshev, faceOf, MONSTER_STEP_MS, PLAYER_STEP_MS, spawnTile, stepToward, surroundGoal,
} from './walk.js';
import { chooseHeroTargetForMonster, chooseMonsterTargetForAlly, desiredCombatRange, isMeleeVocation } from './combatAi.js';
import {
  ammoAreaOffsets,
  combatAreaOffsets,
  meleeSurroundSpots,
  PLAYER_TILE,
  type AmmoAreaShape,
  type CombatAreaId,
} from '@tibia-idle/sim';

const TILE = 32;
const COLS = 13;
const ROWS = 11;
const SCALE = 2;

export const VOCATION_LOOK: Record<number, number> = {
  1: 130,
  2: 144,
  3: 137,
  4: 131,
  5: 130,
  6: 144,
  7: 137,
  8: 131,
  9: 128,
  10: 128,
};

interface SpriteEntry {
  root: Container;
  sprite: AnimatedSprite;
  label: Text;
  bar: Graphics;
  manaBar?: Graphics;
  lastHealth: number;
  aura?: Graphics;
  mountSprite?: AnimatedSprite;
  mountId?: number;
  vitals: boolean;
  tileX: number;
  tileY: number;
  fromX: number;
  fromY: number;
  destX: number;
  destY: number;
  /** Sim AoE seat (Crystal splash). When set, walk here instead of free surround. */
  standX?: number;
  standY?: number;
  walkLeft: number;
  stepMs: number;
  lookType: number;
  atlas: Atlas | null;
  appearance?: PlayerView['appearance'];
  appearanceKey?: string;
  direction: number;
  scaleX: number;
  moving: boolean;
  stationary?: boolean;
  vocationId?: number;
  characterId?: number;
  clickGoalX?: number;
  clickGoalY?: number;
}

export interface PlayerView {
  cityNpc?: 'merchant';
  cityPosition?: CityPosition;
  id?: number;
  name: string;
  vocationId: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  appearance?: { outfit: number; head: number; body: number; legs: number; feet: number; aura?: number; mount?: number; addons?: number };
}

/** BaiakIdle game-window name: lime fill, heavy black outline. */
const NAME_STYLE = {
  fill: 0x00ff00,
  fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
  fontSize: 9,
  fontWeight: 'bold' as const,
  stroke: { color: 0x000000, width: 3, join: 'round' as const },
  dropShadow: {
    color: 0x000000,
    alpha: 1,
    blur: 0,
    distance: 1,
    angle: Math.PI / 2,
  },
  align: 'center' as const,
  letterSpacing: 0.2,
  padding: 4,
};

/** Compact HP plate under the name (same for players and creatures). */
const BAR_WIDTH = 27;
const BAR_HEIGHT = 4;
const NAME_TO_BAR = 1;
const BAR_TO_HEAD = 2;
const NAME_GREEN = 0x00ff00;
const NAME_YELLOW = 0xffff00;
const NAME_RED = 0xff2020;
const HP_GREEN = 0x00ff00;
const HP_YELLOW = 0xe8c800;
const HP_RED = 0xe02020;
const BAR_EMPTY = 0x000000;
const HEAD_CACHE = new Map<number, number>();
const BOUNDS_CACHE = new Map<number, { minX: number; maxX: number; maxY: number }>();

/**
 * Tibia-style cave viewport: tiled floor, fence, player in the middle.
 * Creatures walk toward the player and the player walks toward the pack.
 */
export class CombatScene {
  private app: Application | null = null;
  private creatures: Atlas | null = null;
  private outfits: Atlas | null = null;
  private mounts: Atlas | null = null;
  private tiles: Atlas | null = null;
  private effects: Atlas | null = null;
  private missiles: Atlas | null = null;
  private world: Container | null = null;
  private floor: Container | null = null;
  private actors: Container | null = null;
  private fx: Container | null = null;
  private shots: Array<{
    sprite: Sprite;
    life: number;
    duration: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    onHit?: () => void;
  }> = [];
  private sprites = new Map<number, SpriteEntry>();
  private allies = new Map<string, SpriteEntry>();
  private allyAttackCooldown = new Map<string, number>();
  private monsterTargets = new Map<number, SpriteEntry>();
  private player: SpriteEntry | null = null;
  private floaters: Array<{ text: Text; life: number; maxLife: number; driftX: number }> = [];
  /** Stack index per creature so AOE numbers don't sit on top of each other. */
  private floatStacks = new Map<string, number>();
  private huntId = '';
  private decorations: string[] = [];
  private dead = false;
  private host: HTMLElement | null = null;
  private mounting: Promise<void> | null = null;
  private cityLobby = false;
  private cityPending = false;
  private cityGeneration = 0;
  private cityMove?: (position: CityPosition) => Promise<{ position: CityPosition; accepted: boolean }>;
  private cityMerchant?: () => void;

  setCityMerchant(handler?: () => void): void { this.cityMerchant = handler; }

  setCityMove(handler?: (position: CityPosition) => Promise<{ position: CityPosition; accepted: boolean }>): void { this.cityMove = handler; }

  private alive(): boolean {
    return !this.dead && Boolean(this.app && this.world && this.actors && !this.actors.destroyed);
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    this.dead = false;
    if (this.app) {
      this.attach(host);
      return;
    }
    this.mounting ??= this.boot();
    await this.mounting;
    if (this.dead || !this.app) return;
    if (this.host) this.attach(this.host);
  }

  /** Pull the canvas out of the DOM without touching the shared GPU atlases. */
  detach(): void {
    const canvas = this.app?.canvas;
    if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
  }

  private attach(host: HTMLElement): void {
    if (!this.app) return;
    if (this.app.canvas.parentElement !== host) host.appendChild(this.app.canvas);
    this.app.ticker.start();
  }

  private disposeApp(app: Application): void {
    // Never pass `true`: Pixi treats that as releaseGlobalResources and wipes
    // every atlas texture. React Strict Mode would then remount a blank scene.
    try {
      app.destroy({ removeView: true }, { children: true });
    } catch {
      /* already gone */
    }
  }

  private async boot(): Promise<void> {
    const app = new Application();
    const width = COLS * TILE * SCALE;
    const height = ROWS * TILE * SCALE;
    await app.init({
      background: '#0a0c10',
      antialias: false,
      width,
      height,
      resolution: 1,
      roundPixels: true,
    });
    if (this.dead) {
      this.disposeApp(app);
      this.mounting = null;
      return;
    }
    app.canvas.style.imageRendering = 'pixelated';
    this.app = app;

    const world = new Container();
    world.scale.set(SCALE);
    app.stage.addChild(world);
    this.world = world;
    this.actors = new Container();
    this.actors.sortableChildren = true;
    world.addChild(this.actors);
    this.fx = new Container();
    this.fx.sortableChildren = true;
    world.addChild(this.fx);
    world.eventMode = 'static';
    world.hitArea = new Rectangle(0, 0, COLS * TILE, ROWS * TILE);
    app.canvas.tabIndex = 0;
    app.canvas.setAttribute('aria-label', 'Cidade: clique para andar ou use WASD e as setas');
    app.canvas.addEventListener('keydown', (event) => {
      if (!this.cityLobby || !this.player || document.querySelector('.modal')) return;
      const offsets: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
      const offset = offsets[event.key] ?? offsets[event.key.toLowerCase()];
      if (!offset) return;
      event.preventDefault();
      const x = this.player.destX + offset[0], y = this.player.destY + offset[1];
      if (cityWalkable(x, y)) { this.player.clickGoalX = x; this.player.clickGoalY = y; }
    });
    world.on('pointertap', (event) => {
      if (!this.cityLobby || !this.player) return;
      const position = event.getLocalPosition(world);
      app.canvas.focus({ preventScroll: true });
      const x = Math.floor(position.x / TILE), y = Math.floor(position.y / TILE);
      if (cityWalkable(x, y)) { this.player.clickGoalX = x; this.player.clickGoalY = y; }
    });

    const [creatures, outfits, mounts, tiles, effects, missiles] = await Promise.all([
      loadAtlas('creatures').catch(() => null),
      loadAtlas('outfits').catch(() => null),
      loadAtlas('mounts').catch(() => null),
      loadAtlas('tiles').catch(() => null),
      loadAtlas('effects').catch(() => null),
      loadAtlas('missiles').catch(() => null),
    ]);
    if (this.dead) {
      this.disposeApp(app);
      this.app = null;
      this.world = null;
      this.actors = null;
      this.fx = null;
      this.mounting = null;
      return;
    }
    this.creatures = creatures;
    this.outfits = outfits ?? creatures;
    this.mounts = mounts;
    this.tiles = tiles;
    this.effects = effects;
    this.missiles = missiles;
    void preloadAttackFrames().catch(() => { /* optional */ });
    if (this.huntId) this.paintFloor(this.huntId);
    app.ticker.add((ticker) => {
      if (this.dead || !this.alive()) return;
      try {
        this.tickWalk(ticker.deltaMS);
        this.tickFloaters(ticker.deltaMS);
        this.tickShots(ticker.deltaMS);
      } catch (error) {
        console.error('combat tick', error);
      }
    });
  }

  setHunt(huntId: string): void {
    this.cityLobby = false;
    this.cityGeneration++;
    this.cityPending = false;
    if (this.world) { this.world.position.set(0); this.world.hitArea = new Rectangle(0, 0, COLS * TILE, ROWS * TILE); }
    const changed = this.huntId !== huntId;
    this.huntId = huntId;
    if (!this.alive()) return;
    if (changed) this.clearMonsterSprites();
    if (!changed && this.floor) return;
    if (this.player) {
      this.placeAt(this.player, PLAYER_TILE.x, PLAYER_TILE.y);
      this.face(this.player, 0, 1, false);
    }
    if (this.world) this.paintFloor(huntId);
  }

  setCityLobby(): void {
    this.cityLobby = true;
    this.cityGeneration++;
    this.cityPending = false;
    if (!this.alive() || !this.world) return;
    this.world.hitArea = new Rectangle(0, 0, CITY_WIDTH * TILE, CITY_HEIGHT * TILE);
    this.floor?.destroy({ children: true });
    const floor = new Container();
    if (this.tiles) paintCityScene(floor, this.tiles);
    this.world.addChildAt(floor, 0);
    this.floor = floor;
    if (this.player) {
      this.player.clickGoalX = undefined;
      this.player.clickGoalY = undefined;
    }
  }

  /** Drop actors/events from a previous character without tearing down the GPU app. */
  resetViewport(): void {
    this.clearMonsterSprites();
    for (const entry of this.allies.values()) {
      try { entry.root.destroy({ children: true }); } catch { /* already gone */ }
    }
    this.allies.clear();
    if (this.player) {
      try { this.player.root.destroy({ children: true }); } catch { /* already gone */ }
      this.player = null;
    }
    this.floaters = [];
    this.floatStacks.clear();
    this.allyAttackCooldown.clear();
    this.monsterTargets.clear();
    this.shots = [];
    if (this.fx && !this.fx.destroyed) {
      for (const child of [...this.fx.children]) {
        try { child.destroy(); } catch { /* already gone */ }
      }
    }
  }

  sync(active: ActiveMonsterView[], player: PlayerView, allies: PlayerView[] = []): void {
    if (!this.alive()) return;
    try {
      this.syncPlayer(player);
    } catch (error) {
      console.error('combat player', error);
    }
    try {
      this.syncAllies(allies);
    } catch (error) {
      console.error('combat allies', error);
    }
    const pack = active ?? [];
    const seen = new Set(pack.map((monster) => monster.uid));
    if (pack.length > 0) {
      for (const [uid, entry] of this.sprites) {
        if (seen.has(uid)) continue;
        try { entry.root.destroy({ children: true }); } catch { /* already gone */ }
        this.sprites.delete(uid);
      }
    } else {
      // Between waves: remove corpses instead of leaving faded ghosts that look
      // like broken/invisible monsters (especially after switching characters).
      for (const [uid, entry] of [...this.sprites.entries()]) {
        try { entry.root.destroy({ children: true }); } catch { /* already gone */ }
        this.sprites.delete(uid);
      }
    }
    const px = this.player?.tileX ?? PLAYER_TILE.x;
    const py = this.player?.tileY ?? PLAYER_TILE.y;
    const occupied = this.occupiedTiles();
    const ring = meleeSurroundSpots(px, py);
    pack.forEach((monster, index) => {
      try {
        const existing = this.sprites.get(monster.uid);
        const stand = ring[index % ring.length] ?? ring[0]!;
        if (!existing) {
          const spot = spawnTile(index, occupied, px, py);
          occupied.add(`${spot.x},${spot.y}`);
          const created = this.spawnCreature(monster, spot.x, spot.y);
          if (created) {
            created.root.visible = true;
            created.root.alpha = 1;
            created.sprite.visible = true;
            created.standX = stand.x;
            created.standY = stand.y;
            this.face(created, px - spot.x, py - spot.y, false);
            this.sprites.set(monster.uid, created);
            this.layoutHud(created, monster.health / Math.max(1, monster.maxHealth), undefined, index === 0);
          }
          return;
        }
        existing.root.visible = true;
        existing.root.alpha = 1;
        existing.sprite.visible = true;
        existing.lastHealth = monster.health;
        existing.standX = stand.x;
        existing.standY = stand.y;
        this.layoutHud(existing, monster.health / Math.max(1, monster.maxHealth), undefined, index === 0);
      } catch (error) {
        console.error('combat monster', monster.monsterId, error);
      }
    });
  }

  destroy(): void {
    this.dead = true;
    this.clearMonsterSprites();
    for (const entry of this.allies.values()) {
      try { entry.root.destroy({ children: true }); } catch { /* already gone */ }
    }
    this.allies.clear();
    try { this.player?.root.destroy({ children: true }); } catch { /* already gone */ }
    this.player = null;
    try { this.floor?.destroy({ children: true }); } catch { /* already gone */ }
    this.floor = null;
    try { this.fx?.destroy({ children: true }); } catch { /* already gone */ }
    this.fx = null;
    this.shots = [];
    this.actors = null;
    this.world = null;
    this.creatures = null;
    this.outfits = null;
    this.tiles = null;
    this.effects = null;
    this.missiles = null;
    try { this.app ? this.disposeApp(this.app) : undefined; } catch { /* already gone */ }
    this.app = null;
    this.host = null;
    this.mounting = null;
  }

  private clearMonsterSprites(): void {
    for (const entry of this.sprites.values()) {
      try { entry.root.destroy({ children: true }); } catch { /* already gone */ }
    }
    this.sprites.clear();
  }

  private paintFloor(huntId: string): void {
    if (!this.world || this.dead) return;
    this.floor?.destroy({ children: true });
    const floor = new Container();
    if (this.tiles && huntId) {
      paintHuntScene(floor, this.tiles, huntId);
      if (this.decorations.length) paintDecorations(floor, this.tiles, this.decorations);
    } else {
      floor.addChild(drawCave());
    }
    this.world.addChildAt(floor, 0);
    this.floor = floor;
  }

  setDecorations(unlocked: string[]): void {
    if (!this.alive()) return;
    const ids = unlocked ?? [];
    const next = [...ids].sort().join(',');
    if (next === this.decorations.slice().sort().join(',')) return;
    this.decorations = ids.slice();
    if (this.world && this.huntId && !this.cityLobby) this.paintFloor(this.huntId);
  }

  private syncAllies(allies: PlayerView[]): void {
    const keep = new Set(allies.map((ally) => ally.name));
    for (const [name, entry] of this.allies) {
      if (keep.has(name)) continue;
      entry.root.destroy({ children: true });
      this.allies.delete(name);
    }
    const spots: Array<[number, number]> = [[4, 6], [8, 6], [5, 7], [7, 7]];
    (this.cityLobby ? allies : allies.slice(0, spots.length)).forEach((ally, index) => {
      const existing = this.allies.get(ally.name);
      const [x, y] = this.cityLobby ? [ally.cityPosition?.x ?? CITY_SPAWN.x, ally.cityPosition?.y ?? CITY_SPAWN.y] : spots[index]!;
      if (!existing) {
        const look = ally.appearance?.outfit || VOCATION_LOOK[ally.vocationId] || 128;
        const created = this.spawnLook(
          this.outfits ?? this.creatures,
          look,
          x,
          y,
          DIRECTION_SOUTH,
          ally.name,
          { appearance: ally.appearance, stepMs: PLAYER_STEP_MS, fill: this.cityLobby ? 0x00ff00 : 0x60c8ff, vitals: this.cityLobby, health: 1 },
        );
        if (created) {
          created.vocationId = ally.vocationId;
          created.characterId = ally.id;
          if (this.cityLobby && ally.cityNpc === 'merchant') {
            created.root.eventMode = 'static';
            created.root.cursor = 'pointer';
            created.root.on('pointertap', (event) => {
              event.stopPropagation();
              if (!this.cityLobby) return;
              if (this.player) {
                this.player.clickGoalX = undefined;
                this.player.clickGoalY = undefined;
              }
              this.cityMerchant?.();
            });
          }
          this.allies.set(ally.name, created);
          void this.drawMount(created, ally.appearance);
        }
        return;
      }
      if (this.cityLobby && ally.cityPosition) {
        existing.clickGoalX = ally.cityPosition.x; existing.clickGoalY = ally.cityPosition.y;
      }
      existing.vocationId = ally.vocationId;
      existing.appearance = ally.appearance;
      this.layoutHud(existing, ally.health / Math.max(1, ally.maxHealth));
      void this.drawMount(existing, ally.appearance);
    });
  }

  private syncPlayer(player: PlayerView): void {
    if (!this.player) {
      const look = player.appearance?.outfit || VOCATION_LOOK[player.vocationId] || 128;
      const created = this.spawnLook(
        this.outfits ?? this.creatures,
        look,
        PLAYER_TILE.x,
        PLAYER_TILE.y,
        DIRECTION_SOUTH,
        player.name,
        {
          appearance: player.appearance,
          vitals: true,
          health: player.health,
          stepMs: PLAYER_STEP_MS,
        },
      ) ?? this.spawnLook(
        this.creatures,
        look,
        PLAYER_TILE.x,
        PLAYER_TILE.y,
        DIRECTION_SOUTH,
        player.name,
        { vitals: true, health: player.health, stepMs: PLAYER_STEP_MS },
      );
      if (created) {
        this.player = created;
        if (this.cityLobby) this.placeAt(created, player.cityPosition?.x ?? CITY_SPAWN.x, player.cityPosition?.y ?? CITY_SPAWN.y);
      }
    }
    if (!this.player) return;
    this.player.lastHealth = player.health;
    this.player.appearance = player.appearance;
    const look = player.appearance?.outfit || VOCATION_LOOK[player.vocationId] || 128;
    const poseKey = appearancePoseKey(player.appearance);
    const outfitAtlas = this.outfits ?? this.creatures;
    if (outfitAtlas && (look !== this.player.lookType || poseKey !== this.player.appearanceKey)) {
      this.player.lookType = look;
      this.player.atlas = outfitAtlas;
      this.player.appearanceKey = poseKey;
      try {
        this.face(this.player, 0, 1, false, true);
      } catch {
        // keep last pose
      }
    }
    // Mount can change without outfit pose — always reconcile.
    if ((player.appearance?.mount ?? 0) !== (this.player.mountId ?? 0)) {
      // force redraw path in drawMount
      if (this.player.mountSprite) {
        try { this.player.mountSprite.destroy(); } catch { /* gone */ }
        this.player.mountSprite = undefined;
      }
      this.player.mountId = -1;
    }
    try {
      this.layoutHud(
        this.player,
        player.health / Math.max(1, player.maxHealth),
        player.mana / Math.max(1, player.maxMana),
      );
      this.drawAura(this.player, player.appearance);
      void this.drawMount(this.player, player.appearance);
    } catch (error) {
      console.error('combat player hud', error);
    }
  }

  private drawAura(entry: SpriteEntry, appearance?: PlayerView['appearance']): void {
    if (!entry.aura) {
      entry.aura = new Graphics();
      entry.root.addChildAt(entry.aura, 0);
    }
    entry.aura.clear();
    if (appearance?.aura === 1) {
      entry.aura.ellipse(0, -6, 16, 8);
      entry.aura.fill({ color: 0xe8c547, alpha: 0.35 });
    } else if (appearance?.aura === 2) {
      entry.aura.ellipse(0, -6, 16, 8);
      entry.aura.fill({ color: 0xe05050, alpha: 0.35 });
    }
  }

  private mountTextures(clientid: number, direction: number, moving: boolean): Texture[] {
    const atlas = this.mounts;
    if (!atlas) return [];
    const primary = moving ? GROUP_MOVING : GROUP_IDLE;
    const secondary = moving ? GROUP_IDLE : GROUP_MOVING;
    const dirs = [direction, DIRECTION_SOUTH, DIRECTION_WEST];
    for (const dir of dirs) {
      const posed = atlas.frames(clientid, { group: primary, direction: dir });
      if (posed.textures.length) return posed.textures;
      const walk = atlas.frames(clientid, { group: secondary, direction: dir });
      if (walk.textures.length) return walk.textures;
    }
    return atlas.frames(clientid, { direction: DIRECTION_SOUTH }).textures;
  }

  private syncMountPose(entry: SpriteEntry): void {
    const mountSprite = entry.mountSprite;
    if (!mountSprite || mountSprite.destroyed) return;
    const mountId = entry.appearance?.mount ?? 0;
    if (mountId <= 0) return;
    const clientid = mountsByServerId.get(mountId)?.clientid ?? 0;
    if (clientid <= 0) return;
    try {
      const textures = this.mountTextures(clientid, entry.direction, entry.moving);
      if (!textures.length || textures[0]?.destroyed) return;
      mountSprite.textures = textures;
      mountSprite.scale.x = entry.scaleX;
      mountSprite.animationSpeed = entry.moving ? 0.14 : 0.08;
      mountSprite.play();
    } catch {
      // Keep last mount pose if direction is missing from the atlas.
    }
  }

  private drawMount(entry: SpriteEntry, appearance?: PlayerView['appearance']): void {
    const mountId = appearance?.mount ?? 0;
    if (mountId <= 0) {
      if (entry.mountSprite) {
        try { entry.mountSprite.destroy(); } catch { /* gone */ }
        entry.mountSprite = undefined;
      }
      entry.mountId = 0;
      entry.sprite.y = 0;
      entry.sprite.x = 0;
      this.alignEntrySprites(entry);
      try { this.face(entry, 0, 0, entry.moving, true); } catch { /* keep pose */ }
      return;
    }

    const clientid = mountsByServerId.get(mountId)?.clientid ?? 0;
    if (clientid <= 0 || !this.mounts) {
      entry.mountId = 0;
      this.alignEntrySprites(entry);
      return;
    }

    const needsRebuild = entry.mountId !== mountId || !entry.mountSprite || entry.mountSprite.destroyed;
    entry.mountId = mountId;

    if (needsRebuild) {
      if (entry.mountSprite) {
        try { entry.mountSprite.destroy(); } catch { /* gone */ }
      }
      const textures = this.mountTextures(clientid, entry.direction, entry.moving);
      if (!textures.length) {
        entry.mountId = 0;
        return;
      }
      const sprite = new AnimatedSprite(textures);
      sprite.anchor.set(0.5, 1);
      sprite.scale.x = entry.scaleX;
      sprite.animationSpeed = entry.moving ? 0.14 : 0.08;
      sprite.play();
      const insertAt = entry.aura && entry.root.children.includes(entry.aura) ? 1 : 0;
      entry.root.addChildAt(sprite, Math.min(insertAt, entry.root.children.length));
      entry.mountSprite = sprite;
    }

    this.syncMountPose(entry);
    this.alignEntrySprites(entry);
    try { this.face(entry, 0, 0, entry.moving, true); } catch { /* keep pose */ }
  }

  play(events: SimEvent[]): void {
    if (!this.alive()) return;
    for (const event of events) {
      try {
        this.playOne(event);
      } catch (error) {
        console.error('combat event', event.type, error);
      }
    }
  }

  private playOne(event: SimEvent): void {
    if (event.type === 'loot') {
      const name = itemsById.get(event.itemId ?? 0)?.name ?? 'loot';
      const count = event.count && event.count > 1 ? ` x${event.count}` : '';
      this.floatFree(6.5 * TILE, 4 * TILE, `${name}${count}`, 0xe8c547);
    } else if (event.type === 'heal' || event.type === 'potion') {
      if (event.words && this.player) {
        this.floatFree(this.player.root.x, this.player.root.y - 22, event.words, 0xe07030, 9);
      }
      if (this.player && (event.amount ?? 0) > 0) this.float(this.player, event.amount ?? 0, 0x6ecf7a, '+');
    } else if (event.type === 'level_up') {
      if (this.player) this.floatFree(this.player.root.x, this.player.root.y - 40, `Level ${event.level}!`, 0xe8c547, 11);
    } else if (event.type === 'player_attack') {
      if (event.words && this.player) {
        const caster = this.actorFor(event);
        this.floatFree(caster.root.x, caster.root.y - 22, event.words, 0xe07030, 9);
      }
      // Caster-centered area spells: paint SQM tiles once, not on each target sprite.
      if (event.area && event.words) {
        this.playCasterArea(
          event.areaShape as CombatAreaId | undefined,
          event.effect,
          event.areaDirection,
          this.actorFor(event),
        );
        return;
      }
      // Crystal ammo AoE (burst 3×3 / diamond / storm): missile first, then
      // paint the area centered on where the arrow hits the creature.
      if (event.area && event.areaShape) {
        const paintSplash = () => this.playImpactSplash(event);
        this.showHit(event);
        if (event.shoot) {
          const launched = this.launchEventShot(event, paintSplash);
          if (!launched) paintSplash();
        } else {
          paintSplash();
        }
        return;
      }
      this.playStrike(event);
      return;
    } else if (event.type === 'monster_attack') {
      if (event.dodged && this.player) {
        this.floatFree(this.player.root.x, this.player.root.y - 28, 'DODGE', 0x7ec8e3, 9);
        this.playBursts(event);
        return;
      }
      this.playStrike(event);
      return;
    } else if (event.type === 'condition' && this.player) {
      const amount = event.amount ?? 0;
      if (amount > 0) this.float(this.player, amount, damageTint(event.damageType), '-', 11);
    } else if (event.type === 'buff') {
      if (event.words && this.player) {
        this.floatFree(this.player.root.x, this.player.root.y - 22, event.words, 0x6ecf7a, 9);
      }
    } else if (event.type === 'combo' && this.player) {
      this.floatFree(this.player.root.x, this.player.root.y - 48, `COMBO x${event.combo}`, 0xf0e6c8, 10);
    } else if (event.type === 'monster_spawn' && event.uid !== undefined && event.monsterId) {
      if (!this.sprites.has(event.uid)) {
        const px = this.player?.tileX ?? PLAYER_TILE.x;
        const py = this.player?.tileY ?? PLAYER_TILE.y;
        const occupied = this.occupiedTiles();
        const spot = spawnTile(this.sprites.size, occupied, px, py);
        occupied.add(`${spot.x},${spot.y}`);
        const created = this.spawnCreature(
          { uid: event.uid, monsterId: event.monsterId, health: 1, maxHealth: 1 },
          spot.x,
          spot.y,
        );
        if (created) {
          created.root.visible = true;
          created.sprite.visible = true;
          const ring = meleeSurroundSpots(px, py);
          const stand = ring[this.sprites.size % ring.length] ?? ring[0]!;
          created.standX = stand.x;
          created.standY = stand.y;
          this.sprites.set(event.uid, created);
        }
      }
    } else if (event.type === 'monster_death') {
      const dead = event.uid !== undefined ? this.sprites.get(event.uid) : undefined;
      if (dead) this.playEffect(dead.root.x, dead.root.y - TILE / 2, 3);
    }
    this.playBursts(event);
  }

  private playStrike(event: SimEvent): void {
    // Always show the number immediately. Deferred missile callbacks used to
    // swallow hits when the projectile sprite was destroyed mid-flight (hunt
    // resync, Strict Mode bounce, missing atlas frame) — combat looked frozen.
    this.showHit(event);
    if (isCustomMeleeSwing(event)) {
      void this.playWeaponAttack(event);
    } else if (event.shoot) {
      try {
        this.launchEventShot(event);
      } catch (error) {
        console.error('combat shot', error);
      }
    }
    // Melee uses hit bursts only — no red bar spanning attacker→target.
  }

  private async playWeaponAttack(event: SimEvent): Promise<void> {
    if (!this.alive() || !this.fx || event.type !== 'player_attack' || !event.attackEffect) return;
    const target = this.resolveMonster(event.uid);
    if (!target) return;
    try {
      const [textures, speed] = await Promise.all([
        loadAttackFrames(event.attackEffect),
        attackAnimationSpeed(),
      ]);
      if (!this.alive() || !this.fx || textures.length === 0 || textures[0]?.destroyed) return;

      const sprite = new AnimatedSprite(textures);
      // Crystal 15.x: directional melee swing on the target (CreatureMark), not a tile CONST_ME.
      sprite.anchor.set(0.5, 0.78);
      sprite.loop = false;
      sprite.animationSpeed = speed;
      sprite.x = target.root.x;
      sprite.y = target.root.y - TILE * 0.42;

      const player = this.player;
      if (player) {
        const facing = faceOf(target.tileX - player.tileX, target.tileY - player.tileY);
        sprite.scale.x = facing.scaleX;
        sprite.scale.y = facing.direction === DIRECTION_NORTH ? -1 : 1;
      }

      sprite.onComplete = () => {
        try { sprite.destroy(); } catch { /* gone */ }
      };
      sprite.play();
      this.fx.addChild(sprite);
    } catch (error) {
      console.error('weapon attack fx', event.attackEffect, error);
    }
  }

  private showHit(event: SimEvent): void {
    if (event.type === 'player_attack') {
      const target = this.resolveMonster(event.uid);
      const amount = event.amount ?? 0;
      if (target && amount > 0) {
        this.floatDamage(
          target,
          amount,
          outgoingDamageTint(event.damageType, event.critical),
          event.critical ? 'crit' : 'out',
        );
      } else if (target && event.missed) {
        this.floatLabel(target.root.x, target.root.y - 30, 'MISS', 0xb0b0b0, 'out');
      } else if (target && event.blocked) {
        this.floatLabel(target.root.x, target.root.y - 30, '0', 0xb0b0b0, 'out');
      } else if (!target && amount > 0) {
        // Sprite not ready yet — still show the number near the player.
        const anchor = this.player;
        if (anchor) {
          this.floatLabel(
            anchor.root.x + 18,
            anchor.root.y - 36,
            String(Math.max(1, Math.round(amount))),
            outgoingDamageTint(event.damageType, event.critical),
            'out',
          );
        }
      }
      if (event.critical && target) {
        this.floatLabel(target.root.x + 10, target.root.y - 40, 'CRIT', 0xfff06a, 'tag');
      }
      if (event.fatal && target) {
        this.floatLabel(target.root.x - 10, target.root.y - 42, 'FATAL', 0xffe066, 'tag');
      }
      if (event.leech && this.player) {
        this.floatDamage(this.player, event.leech, 0x66ff66, 'heal');
      }
    } else if (event.type === 'monster_attack') {
      const monster = this.resolveMonster(event.uid);
      const target = monster ? this.findHeroTargetForMonster(monster, event.uid) : this.player;
      const amount = event.amount ?? 0;
      if (amount > 0 && target) {
        this.floatDamage(target, amount, damageTint(event.damageType), 'in');
      } else if (event.blocked && target) {
        this.floatLabel(target.root.x, target.root.y - 30, '0', 0xb0b0b0, 'in');
      }
    } else if (event.type === 'condition' && this.player) {
      const amount = event.amount ?? 0;
      if (amount > 0) this.floatDamage(this.player, amount, damageTint(event.damageType), 'in');
    }
    this.playBursts(event);
  }

  private resolveMonster(uid: number | undefined): SpriteEntry | undefined {
    if (uid === undefined) return undefined;
    return this.sprites.get(uid);
  }

  private actorFor(event: SimEvent): SpriteEntry {
    if (event.actorId !== undefined) {
      const ally = [...this.allies.values()].find((entry) => entry.characterId === event.actorId);
      if (ally) return ally;
    }
    return this.player ?? [...this.allies.values()][0]!;
  }

  private findHeroTargetForMonster(monster: SpriteEntry, uid?: number): SpriteEntry | null {
    const assigned = uid !== undefined ? this.monsterTargets.get(uid) : undefined;
    if (assigned && assigned.root.alpha >= 1) return assigned;
    const heroes: SpriteEntry[] = [];
    if (this.player) heroes.push(this.player);
    for (const ally of this.allies.values()) heroes.push(ally);
    if (heroes.length === 0) return null;
    const target = chooseHeroTargetForMonster(
      { tileX: monster.destX, tileY: monster.destY },
      this.player ?? { tileX: PLAYER_TILE.x, tileY: PLAYER_TILE.y },
      heroes.map((hero) => ({ tileX: hero.destX, tileY: hero.destY })),
    );
    if (!target) return null;
    const match = heroes.find((hero) => hero.destX === target.tileX && hero.destY === target.tileY);
    if (match) return match;
    return this.player ?? null;
  }

  private tryAllyStrike(name: string, ally: SpriteEntry, target: SpriteEntry, delta: number): void {
    const key = `${name}:${Math.round(target.root.x)}:${Math.round(target.root.y)}`;
    const cooldown = (this.allyAttackCooldown.get(key) ?? 0) - delta;
    this.allyAttackCooldown.set(key, Math.max(0, cooldown));
    if (cooldown > 0) return;
    this.allyAttackCooldown.set(key, 650);
    const amount = Math.max(1, Math.round((ally.lastHealth ?? 1) * 0.12));
    this.floatDamage(target, amount, 0x7ec8ff, 'out');
    this.playEffect(target.root.x, target.root.y - TILE / 2, 14);
  }

  private playBursts(event: SimEvent): void {
    for (const burst of burstsFor(event)) {
      const entry = burst.on === 'player'
        ? this.player
        : event.uid !== undefined ? this.sprites.get(event.uid) : undefined;
      if (entry) this.playEffect(entry.root.x, entry.root.y - TILE / 2, burst.id);
    }
  }

  /** Paint caster-centered Crystal areas (waves, beams, ultimates, exori). */
  private playCasterArea(
    shape: CombatAreaId | undefined,
    effectName?: string,
    direction?: number,
    caster: SpriteEntry = this.player!,
  ): void {
    if (!caster) return;
    const effectId = magicEffectId(effectName) ?? 10; // HITAREA
    const area = shape ?? 'square1';
    const cx = caster.tileX;
    const cy = caster.tileY;
    for (const [dx, dy] of combatAreaOffsets(area, direction ?? DIRECTION_SOUTH)) {
      this.playEffect((cx + dx) * TILE + TILE / 2, (cy + dy) * TILE + TILE / 2, effectId);
    }
  }

  /** @deprecated use playCasterArea — kept for any callers expecting the old 8-ring. */
  private playAreaEffect(effectName?: string): void {
    this.playCasterArea('square1', effectName);
  }

  /** Paint Crystal createCombatArea centered on the creature the arrow hit. */
  private playImpactSplash(event: SimEvent): void {
    const shape = event.areaShape as AmmoAreaShape | undefined;
    if (!shape) return;
    const focus = event.uid !== undefined ? this.sprites.get(event.uid) : undefined;
    if (!focus || focus.root.destroyed) return;
    const effectId = magicEffectId(event.effect) ?? 5; // EXPLOSIONAREA
    // Center on the creature (same height as hit bursts), then ±1 SQM around.
    const ox = focus.root.x;
    const oy = focus.root.y - TILE / 2;
    for (const [dx, dy] of ammoAreaOffsets(shape)) {
      this.playEffect(ox + dx * TILE, oy + dy * TILE, effectId);
    }
  }

  private playEffect(x: number, y: number, effectId: number): void {
    if (!this.fx || this.fx.destroyed) return;
    try {
      const frames = this.effects?.frames(effectId);
      const textures = frames?.textures.length
        ? frames.textures
        : this.effects?.icon(effectId)
          ? [this.effects.icon(effectId)!]
          : [];
      if (textures.length) {
        const sprite = new AnimatedSprite(textures);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = x;
        sprite.y = y;
        sprite.loop = false;
        sprite.animationSpeed = textures.length > 1 ? 0.35 : 0.05;
        sprite.onComplete = () => {
          if (!sprite.destroyed) sprite.destroy();
        };
        this.fx.addChild(sprite);
        sprite.gotoAndPlay(0);
        if (textures.length <= 1) {
          window.setTimeout(() => {
            if (!sprite.destroyed) sprite.destroy();
          }, 180);
        }
        return;
      }
      const flash = new Graphics();
      flash.rect(-8, -8, 16, 16);
      flash.fill({ color: 0xff4a3a, alpha: 0.75 });
      flash.x = x;
      flash.y = y;
      this.fx.addChild(flash);
      window.setTimeout(() => {
        if (!flash.destroyed) flash.destroy();
      }, 180);
    } catch (error) {
      console.error('combat effect', error);
    }
  }

  private launchEventShot(event: SimEvent, onHit?: () => void): boolean {
    if (!event.shoot || !this.player) return false;
    const monster = event.uid !== undefined ? this.sprites.get(event.uid) : undefined;
    if (!monster) return false;
    if (event.type === 'player_attack') {
      this.launchShot(this.actorFor(event), monster, event.shoot, onHit);
      return true;
    }
    if (event.type === 'monster_attack') {
      const target = this.findHeroTargetForMonster(monster, event.uid);
      if (!target) return false;
      this.launchShot(monster, target, event.shoot, onHit);
      return true;
    }
    return false;
  }

  private launchShot(from: SpriteEntry, to: SpriteEntry, shoot: string, onHit?: () => void): void {
    if (!this.fx || this.fx.destroyed) {
      onHit?.();
      return;
    }
    const x0 = from.root.x;
    const y0 = from.root.y - TILE / 2;
    const x1 = to.root.x;
    const y1 = to.root.y - TILE / 2;
    const id = shootEffectId(shoot);
    try {
      const aim = missileAim(x1 - x0, y1 - y0);
      const frames = id && this.missiles
        ? this.missiles.frames(id, { direction: aim.direction, addon: aim.addon })
        : { textures: [] as never[] };
      const texture = frames.textures[0] ?? (id && this.missiles ? this.missiles.icon(id) : null);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = x0;
        sprite.y = y0;
        this.fx.addChild(sprite);
        this.shots.push({ sprite, life: 0, duration: 280, x0, y0, x1, y1, onHit });
        return;
      }
      // Missing missile atlas: skip the ugly gold bar fallback.
      onHit?.();
    } catch (error) {
      console.error('combat shot', error);
      onHit?.();
    }
  }

  private tickShots(delta: number): void {
    this.shots = this.shots.filter((shot) => {
      if (shot.sprite.destroyed) {
        try { shot.onHit?.(); } catch (error) { console.error('combat hit', error); }
        return false;
      }
      shot.life += delta;
      const t = Math.min(1, shot.life / shot.duration);
      shot.sprite.x = shot.x0 + (shot.x1 - shot.x0) * t;
      shot.sprite.y = shot.y0 + (shot.y1 - shot.y0) * t;
      if (t < 1) return true;
      shot.sprite.destroy();
      try { shot.onHit?.(); } catch (error) { console.error('combat hit', error); }
      return false;
    });
  }

  private spawnCreature(monster: ActiveMonsterView, tx: number, ty: number): SpriteEntry | null {
    const def = monstersById.get(monster.monsterId);
    const look = def?.outfit?.lookType ?? def?.lookType ?? 0;
    const name = def?.name ?? monster.monsterId;
    const appearance = creatureRecolorAppearance(this.creatures, look, def?.outfit);
    return this.spawnLook(this.creatures, look, tx, ty, DIRECTION_SOUTH, name, {
      health: monster.health,
      stepMs: MONSTER_STEP_MS,
      appearance,
    });
  }

  private spawnLook(
    atlas: Atlas | null,
    lookType: number,
    tx: number,
    ty: number,
    direction: number,
    name: string,
    options: {
      appearance?: PlayerView['appearance'];
      vitals?: boolean;
      health?: number;
      stepMs?: number;
      fill?: number;
    } = {},
  ): SpriteEntry | null {
    const actors = this.actors;
    if (!actors || actors.destroyed) return null;
    let recoloured: Texture[] = [];
    try {
      const mounted = (options.appearance?.mount ?? 0) > 0;
      recoloured = atlas && options.appearance
        ? recoloredFrames(atlas, lookType, options.appearance, direction, GROUP_MOVING, { mounted })
        : [];
    } catch {
      recoloured = [];
    }
    const moving = atlas && lookType ? atlas.frames(lookType, { group: GROUP_MOVING, direction }) : { textures: [] as Texture[] };
    const frames = moving.textures.length
      ? moving
      : atlas && lookType
        ? atlas.frames(lookType, { direction })
        : { textures: [] as Texture[] };
    const textures = recoloured.length
      ? recoloured
      : frames.textures.length
        ? frames.textures
        : atlas && lookType && atlas.icon(lookType)
          ? [atlas.icon(lookType)!]
          : [placeholderTexture(options.vitals ? 0x3d8f4a : 0xb43c3c)];

    let sprite: AnimatedSprite;
    try {
      sprite = new AnimatedSprite(textures);
      sprite.anchor.set(0.5, 1);
      sprite.animationSpeed = 0.12;
      sprite.play();
    } catch {
      sprite = new AnimatedSprite([placeholderTexture(options.vitals ? 0x3d8f4a : 0xb43c3c)]);
      sprite.anchor.set(0.5, 1);
    }

    const label = new Text({
      text: name,
      style: { ...NAME_STYLE, fill: options.fill ?? NAME_GREEN },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    label.roundPixels = true;

    const bar = new Graphics();
    const root = new Container();
    root.x = tx * TILE + TILE / 2;
    root.y = ty * TILE + TILE;
    root.addChild(sprite);
    root.addChild(label);
    root.addChild(bar);

    const entry: SpriteEntry = {
      root,
      sprite,
      label,
      bar,
      lastHealth: options.health ?? 1,
      vitals: Boolean(options.vitals),
      tileX: tx,
      tileY: ty,
      fromX: tx,
      fromY: ty,
      destX: tx,
      destY: ty,
      walkLeft: 0,
      stepMs: options.stepMs ?? MONSTER_STEP_MS,
      lookType,
      atlas,
      appearance: options.appearance,
      appearanceKey: options.appearance
        ? [
            options.appearance.outfit ?? lookType,
            options.appearance.head,
            options.appearance.body,
            options.appearance.legs,
            options.appearance.feet,
            options.appearance.addons ?? 0,
            options.appearance.mount ?? 0,
          ].join(':')
        : undefined,
      direction,
      scaleX: 1,
      moving: false,
    };
    this.placeAt(entry, tx, ty);
    actors.addChild(root);
    try {
      this.layoutHud(entry, 1);
      this.face(entry, 0, 1, false);
    } catch {
      // Pose/HUD can fail on a missing look; the body is still on the floor.
    }
    return entry;
  }

  private placeAt(entry: SpriteEntry, x: number, y: number): void {
    entry.tileX = x;
    entry.tileY = y;
    entry.fromX = x;
    entry.fromY = y;
    entry.destX = x;
    entry.destY = y;
    entry.walkLeft = 0;
    entry.root.x = x * TILE + TILE / 2;
    entry.root.y = y * TILE + TILE;
    this.alignEntrySprites(entry);
    this.updateDepth(entry);
  }

  /** Center outfit/creature art on the SQM (Tibia sitOnTile — scenes.ts). */
  private alignEntrySprites(entry: SpriteEntry): void {
    sitSpriteOnTile(entry.sprite, entry.scaleX);
    if (entry.mountSprite) {
      sitSpriteOnTile(entry.mountSprite, entry.scaleX);
      entry.sprite.y = entry.mountSprite.y - Math.min(12, Math.floor(entry.mountSprite.texture.height * 0.22));
    }
  }

  /** Y-sort with player/allies drawn above monsters at the same feet row. */
  private updateDepth(entry: SpriteEntry): void {
    let bias = 0;
    if (entry.vitals) bias = 6;
    else if (entry.stationary) bias = 3;
    entry.root.zIndex = Math.round(entry.root.y * 10 + bias);
  }

  private occupiedTiles(ignore?: SpriteEntry): Set<string> {
    const blocked = new Set<string>();
    if (this.player && this.player !== ignore) {
      blocked.add(`${this.player.destX},${this.player.destY}`);
    }
    for (const entry of this.sprites.values()) {
      if (entry === ignore) continue;
      blocked.add(`${entry.destX},${entry.destY}`);
    }
    for (const entry of this.allies.values()) {
      if (entry === ignore) continue;
      blocked.add(`${entry.destX},${entry.destY}`);
    }
    return blocked;
  }

  private tickWalk(delta: number): void {
    if (!this.alive()) return;
    const player = this.player;
    if (player) this.advanceWalk(player, delta);
    if (this.cityLobby) {
      for (const ally of this.allies.values()) {
        this.advanceWalk(ally, delta);
        if (ally.walkLeft <= 0 && ally.clickGoalX !== undefined && ally.clickGoalY !== undefined) {
          const next = cityPath({ x: ally.tileX, y: ally.tileY }, { x: ally.clickGoalX, y: ally.clickGoalY })[0];
          if (next) this.beginStep(ally, next.x, next.y);
        }
      }
      if (player && player.walkLeft <= 0 && !this.cityPending && this.cityMove
        && player.clickGoalX !== undefined && player.clickGoalY !== undefined) {
        const next = cityPath({ x: player.tileX, y: player.tileY }, { x: player.clickGoalX, y: player.clickGoalY })[0];
        if (!next) { player.clickGoalX = undefined; player.clickGoalY = undefined; }
        else {
          this.cityPending = true;
          const generation = this.cityGeneration;
          void this.cityMove(next).then((result) => {
            if (!this.cityLobby || this.player !== player || generation !== this.cityGeneration) return;
            if (result.accepted) this.beginStep(player, result.position.x, result.position.y);
            else { this.placeAt(player, result.position.x, result.position.y); player.clickGoalX = undefined; player.clickGoalY = undefined; }
          }).catch(() => { if (this.player === player) { player.clickGoalX = undefined; player.clickGoalY = undefined; } })
            .finally(() => { if (generation === this.cityGeneration) this.cityPending = false; });
        }
      }
      if (player && this.world) {
        const cameraX = Math.max(0, Math.min((CITY_WIDTH - COLS) * TILE, player.root.x - COLS * TILE / 2));
        const cameraY = Math.max(0, Math.min((CITY_HEIGHT - ROWS) * TILE, player.root.y - ROWS * TILE / 2 - TILE * 2));
        this.world.position.set(-cameraX * SCALE, -cameraY * SCALE);
      }
      this.sortActors();
      return;
    }
    for (const entry of this.sprites.values()) this.advanceWalk(entry, delta);
    for (const entry of this.allies.values()) this.advanceWalk(entry, delta);

    if (player && player.walkLeft <= 0) {
      const target = this.closestMonster(player);
      if (target) this.chase(player, target.destX, target.destY);
    }
    const heroes: SpriteEntry[] = [];
    if (player && player.root.alpha >= 1) heroes.push(player);
    heroes.push(...[...this.allies.values()].filter((entry) => entry.root.alpha >= 1));
    const liveMonsterIds = new Set<number>();
    [...this.sprites.entries()]
      .sort(([left], [right]) => left - right)
      .forEach(([uid, entry], index) => {
        liveMonsterIds.add(uid);
        const target = heroes.length > 0 ? heroes[index % heroes.length] : undefined;
        if (target) this.monsterTargets.set(uid, target);
        if (entry.walkLeft > 0 || entry.root.alpha < 1 || !target) return;
        if (target !== player) {
          entry.standX = undefined;
          entry.standY = undefined;
        }
        this.chaseMonster(entry, target.destX, target.destY, this.occupiedTiles(entry), uid);
      });
    for (const uid of this.monsterTargets.keys()) {
      if (!liveMonsterIds.has(uid)) this.monsterTargets.delete(uid);
    }
    for (const [name, ally] of this.allies) {
      if (ally.walkLeft > 0 || ally.root.alpha < 1) continue;
      const localReserved = this.occupiedTiles(ally);
      const target = this.closestMonster(ally) ?? player;
      if (!target) continue;
      const monsterTarget = chooseMonsterTargetForAlly(ally, player ?? ally, [...this.sprites.values()].map((entry) => ({ tileX: entry.destX, tileY: entry.destY })));
      if (monsterTarget) {
        const monsterSprite = [...this.sprites.values()].find((entry) => entry.destX === monsterTarget.tileX && entry.destY === monsterTarget.tileY) ?? null;
        if (monsterSprite && chebyshev(ally.tileX, ally.tileY, monsterSprite.destX, monsterSprite.destY) <= 1) {
          this.tryAllyStrike(name, ally, monsterSprite, delta);
        }
      }
      this.chaseAlly(ally, target, localReserved, [...this.allies.keys()].indexOf(name));
    }
    this.sortActors();
  }

  private chaseAlly(entry: SpriteEntry, target: SpriteEntry, reserved: Set<string>, salt: number): void {
    const dist = chebyshev(entry.tileX, entry.tileY, target.destX, target.destY);
    const desired = desiredCombatRange(entry.vocationId);
    const melee = isMeleeVocation(entry.vocationId ?? 0);

    if (melee) {
      if (dist <= 1) {
        reserved.add(`${entry.tileX},${entry.tileY}`);
        this.face(entry, target.destX - entry.tileX, target.destY - entry.tileY, false);
        return;
      }
    } else if (dist <= desired) {
      reserved.add(`${entry.tileX},${entry.tileY}`);
      this.face(entry, target.destX - entry.tileX, target.destY - entry.tileY, false);
      return;
    }

    const open = new Set(reserved);
    open.delete(`${entry.tileX},${entry.tileY}`);
    open.delete(`${entry.destX},${entry.destY}`);
    const goal = surroundGoal(entry.tileX, entry.tileY, target.destX, target.destY, open, salt + 31);
    if (!goal) {
      this.face(entry, target.destX - entry.tileX, target.destY - entry.tileY, false);
      return;
    }
    if (goal.x === entry.tileX && goal.y === entry.tileY) {
      reserved.add(`${entry.tileX},${entry.tileY}`);
      return;
    }
    const blocked = new Set(open);
    blocked.delete(`${goal.x},${goal.y}`);
    const next = stepToward(entry.tileX, entry.tileY, goal.x, goal.y, blocked);
    if (!next) return;
    reserved.add(`${next.x},${next.y}`);
    this.beginStep(entry, next.x, next.y);
  }

  private advanceWalk(entry: SpriteEntry, delta: number): void {
    if (entry.walkLeft <= 0) return;
    entry.walkLeft = Math.max(0, entry.walkLeft - delta);
    const progress = 1 - entry.walkLeft / entry.stepMs;
    const x = entry.fromX + (entry.destX - entry.fromX) * progress;
    const y = entry.fromY + (entry.destY - entry.fromY) * progress;
    entry.root.x = x * TILE + TILE / 2;
    entry.root.y = y * TILE + TILE;
    this.updateDepth(entry);
    if (entry.walkLeft > 0) return;
    entry.tileX = entry.destX;
    entry.tileY = entry.destY;
    this.updateDepth(entry);
    // Keep facing the step we just finished (walk direction).
    this.face(entry, entry.destX - entry.fromX, entry.destY - entry.fromY, false);
  }

  /** Player closes on a monster tile (melee range). */
  private chase(entry: SpriteEntry, targetX: number, targetY: number): void {
    if (chebyshev(entry.tileX, entry.tileY, targetX, targetY) <= 1) {
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }
    const next = stepToward(entry.tileX, entry.tileY, targetX, targetY, this.occupiedTiles(entry));
    if (!next) {
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }
    this.beginStep(entry, next.x, next.y);
  }

  /**
   * Creature approach: prefer the sim AoE stand seat (burst 3×3 must match the
   * screen). Otherwise pick a free adjacent SQM and hold.
   */
  private chaseMonster(
    entry: SpriteEntry,
    targetX: number,
    targetY: number,
    reserved: Set<string>,
    salt: number,
  ): void {
    const goalX = entry.standX;
    const goalY = entry.standY;
    if (goalX !== undefined && goalY !== undefined) {
      if (entry.tileX === goalX && entry.tileY === goalY) {
        reserved.add(`${entry.tileX},${entry.tileY}`);
        this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
        return;
      }
      const blocked = new Set(reserved);
      blocked.delete(`${entry.tileX},${entry.tileY}`);
      blocked.delete(`${entry.destX},${entry.destY}`);
      blocked.delete(`${goalX},${goalY}`);
      const next = stepToward(entry.tileX, entry.tileY, goalX, goalY, blocked);
      if (!next) {
        this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
        return;
      }
      reserved.add(`${next.x},${next.y}`);
      this.beginStep(entry, next.x, next.y);
      return;
    }

    // Already in the melee ring — hold the SQM and look at the player.
    if (chebyshev(entry.tileX, entry.tileY, targetX, targetY) <= 1) {
      reserved.add(`${entry.tileX},${entry.tileY}`);
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }

    // Own tile is occupied in `reserved`; ignore it so pathfinding can leave / re-claim.
    const open = new Set(reserved);
    open.delete(`${entry.tileX},${entry.tileY}`);
    open.delete(`${entry.destX},${entry.destY}`);

    const goal = surroundGoal(entry.tileX, entry.tileY, targetX, targetY, open, salt);
    if (!goal) {
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }

    if (goal.x === entry.tileX && goal.y === entry.tileY) {
      reserved.add(`${entry.tileX},${entry.tileY}`);
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }

    reserved.add(`${goal.x},${goal.y}`);
    const blocked = new Set(open);
    // May step onto the claimed goal.
    blocked.delete(`${goal.x},${goal.y}`);
    const next = stepToward(entry.tileX, entry.tileY, goal.x, goal.y, blocked);
    if (!next) {
      this.face(entry, targetX - entry.tileX, targetY - entry.tileY, false);
      return;
    }
    reserved.add(`${next.x},${next.y}`);
    this.beginStep(entry, next.x, next.y);
  }

  private beginStep(entry: SpriteEntry, x: number, y: number): void {
    entry.fromX = entry.tileX;
    entry.fromY = entry.tileY;
    entry.destX = x;
    entry.destY = y;
    entry.walkLeft = entry.stepMs;
    this.face(entry, x - entry.tileX, y - entry.tileY, true);
  }

  private closestMonster(player: SpriteEntry): SpriteEntry | null {
    let best: SpriteEntry | null = null;
    let bestDist = Infinity;
    for (const entry of this.sprites.values()) {
      if (entry.root.alpha < 1) continue;
      const dist = chebyshev(player.tileX, player.tileY, entry.destX, entry.destY);
      if (dist < bestDist) {
        best = entry;
        bestDist = dist;
      }
    }
    return best;
  }

  private face(entry: SpriteEntry, dx: number, dy: number, moving: boolean, force = false): void {
    const facing = faceOf(dx, dy);
    const same = facing.direction === entry.direction && facing.scaleX === entry.scaleX && entry.moving === moving;
    entry.direction = facing.direction;
    entry.scaleX = facing.scaleX;
    entry.moving = moving;
    entry.sprite.scale.x = facing.scaleX;
    if (!force && same && entry.sprite.playing) {
      this.alignEntrySprites(entry);
      return;
    }
    try {
      const textures = this.poseTextures(entry, facing.direction, moving);
      if (!textures.length || textures[0]?.destroyed) {
        if (!entry.sprite.playing && entry.sprite.textures.length) entry.sprite.play();
        this.alignEntrySprites(entry);
        return;
      }
      entry.sprite.textures = textures;
      entry.sprite.animationSpeed = moving ? 0.14 : 0.08;
      entry.sprite.play();
      this.syncMountPose(entry);
      this.alignEntrySprites(entry);
    } catch {
      // Keep the last good pose if a looktype has no packed direction.
    }
  }

  private poseTextures(entry: SpriteEntry, direction: number, moving: boolean) {
    const atlas = entry.atlas;
    if (!atlas || !entry.lookType) return [];
    const mounted = (entry.appearance?.mount ?? 0) > 0;
    const poseOpts = { mounted };
    // Many player outfits only pack idle (group 0); prefer it when moving frames are empty.
    const primary = moving ? GROUP_MOVING : GROUP_IDLE;
    const secondary = moving ? GROUP_IDLE : GROUP_MOVING;
    const dirs = [direction, DIRECTION_SOUTH, DIRECTION_WEST];
    for (const dir of dirs) {
      if (entry.appearance) {
        const frames = recoloredFrames(atlas, entry.lookType, entry.appearance, dir, primary, poseOpts);
        if (frames.length) return frames;
        const idle = recoloredFrames(atlas, entry.lookType, entry.appearance, dir, secondary, poseOpts);
        if (idle.length) return idle;
      } else {
        const posed = atlas.frames(entry.lookType, { group: primary, direction: dir });
        if (posed.textures.length) return posed.textures;
        const walk = atlas.frames(entry.lookType, { group: secondary, direction: dir });
        if (walk.textures.length) return walk.textures;
      }
    }
    return atlas.frames(entry.lookType, { direction: DIRECTION_SOUTH }).textures;
  }

  private sortActors(): void {
    if (!this.actors) return;
    if (this.player) this.updateDepth(this.player);
    for (const entry of this.sprites.values()) this.updateDepth(entry);
    for (const entry of this.allies.values()) this.updateDepth(entry);
  }

  /**
   * BaiakIdle plate: lime name + thick black outline, then a short HP bar
   * centered on the head (players and creatures share the same look).
   */
  private layoutHud(entry: SpriteEntry, hpRatio: number, _manaRatio?: number, targeted = false): void {
    const headY = visualHeadY(entry.sprite);
    const barTop = headY - BAR_TO_HEAD - BAR_HEIGHT;
    entry.label.y = barTop - NAME_TO_BAR;
    entry.label.anchor.set(0.5, 1);
    try {
      entry.label.style.fill = targeted ? NAME_RED : entry.vitals ? NAME_GREEN : nameColorFor(hpRatio);
      entry.label.style.stroke = { color: 0x000000, width: 3, join: 'round' };
    } catch {
      // Pixi fill styles can reject a raw number after a theme swap.
    }
    this.drawBar(entry.bar, hpRatio, barTop, vitalColor(hpRatio), BAR_EMPTY);
  }

  private drawBar(bar: Graphics, ratio: number, y: number, fill: number, empty: number): void {
    const x = -BAR_WIDTH / 2;
    const clamped = Math.max(0, Math.min(1, ratio));
    bar.clear();
    // Outer 1px black frame (BaiakIdle).
    bar.rect(x - 1, y - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2);
    bar.fill(0x000000);
    // Empty track.
    bar.rect(x, y, BAR_WIDTH, BAR_HEIGHT);
    bar.fill(empty);
    // Vital fill — pixel-aligned so the green edge stays crisp when scaled.
    const fillW = Math.round(BAR_WIDTH * clamped);
    if (fillW > 0) {
      bar.rect(x, y, fillW, BAR_HEIGHT);
      bar.fill(fill);
    }
  }

  /**
   * Tibia Global animated text — compact (same scale as nameplates), white/red hits.
   * World is scaled ×2, so fontSize 10 ≈ 20px on screen.
   */
  private floatDamage(
    entry: SpriteEntry,
    amount: number,
    color: number,
    kind: 'out' | 'in' | 'heal' | 'crit',
  ): void {
    const shown = amount > 0 ? Math.max(1, Math.round(amount)) : 0;
    const prefix = kind === 'heal' ? '+' : '';
    const key = `${Math.round(entry.root.x)},${Math.round(entry.root.y)}`;
    const stack = this.floatStacks.get(key) ?? 0;
    this.floatStacks.set(key, stack + 1);
    window.setTimeout(() => {
      const next = (this.floatStacks.get(key) ?? 1) - 1;
      if (next <= 0) this.floatStacks.delete(key);
      else this.floatStacks.set(key, next);
    }, 280);
    const jitter = ((stack % 5) - 2) * 5;
    const lift = 28 + stack * 10;
    const size = kind === 'crit' ? 12 : 11;
    this.spawnFloater(
      entry.root.x + jitter,
      entry.root.y - lift,
      `${prefix}${shown}`,
      color,
      size,
      1200,
    );
  }

  private floatLabel(
    x: number,
    y: number,
    label: string,
    color: number,
    kind: 'out' | 'in' | 'tag' | 'heal' = 'out',
  ): void {
    const size = kind === 'tag' ? 9 : 10;
    this.spawnFloater(x, y, label, color, size, 1000);
  }

  /** Legacy helpers used by loot / words / level-up. */
  private float(entry: SpriteEntry, amount: number, color: number, sign = '-', _size = 11): void {
    const shown = amount > 0 ? Math.max(1, Math.round(amount)) : 0;
    const kind = sign === '+' ? 'heal' : 'out';
    this.floatDamage(entry, shown, color, kind);
  }

  private floatFree(x: number, y: number, label: string, color: number, size = 9): void {
    this.spawnFloater(x, y, label, color, size, 1100);
  }

  private spawnFloater(
    x: number,
    y: number,
    label: string,
    color: number,
    size: number,
    life: number,
  ): void {
    const layer = this.fx;
    if (!layer || layer.destroyed) return;
    // Keep fx above floor/actors so hit numbers are never buried.
    if (this.world && layer.parent === this.world) this.world.addChild(layer);
    const text = new Text({
      text: label,
      resolution: 2,
      style: {
        fill: color,
        fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
        fontSize: size,
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3, join: 'round' },
        dropShadow: {
          color: 0x000000,
          alpha: 1,
          blur: 0,
          distance: 1,
          angle: Math.PI / 2,
        },
        align: 'center',
        padding: 3,
      },
    });
    text.anchor.set(0.5);
    text.roundPixels = true;
    text.x = x;
    text.y = y;
    text.zIndex = 2000;
    layer.addChild(text);
    this.floaters.push({
      text,
      life,
      maxLife: life,
      driftX: (Math.random() - 0.5) * 0.01,
    });
  }

  private tickFloaters(delta: number): void {
    this.floaters = this.floaters.filter((floater) => {
      if (floater.text.destroyed) return false;
      floater.life -= delta;
      const t = 1 - floater.life / floater.maxLife;
      floater.text.y -= delta * 0.045;
      floater.text.x += delta * floater.driftX;
      floater.text.alpha = t < 0.65 ? 1 : Math.max(0, (1 - t) / 0.35);
      if (floater.life > 0) return true;
      floater.text.destroy();
      return false;
    });
  }
}

function placeholderTexture(color: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(8, 12, 16, 28);
    ctx.fillStyle = '#111';
    ctx.fillRect(12, 6, 8, 8);
  }
  return Texture.from(canvas);
}

function vitalColor(ratio: number): number {
  if (ratio > 0.6) return HP_GREEN;
  if (ratio > 0.3) return HP_YELLOW;
  return HP_RED;
}

function nameColorFor(ratio: number): number {
  if (ratio > 0.6) return NAME_GREEN;
  if (ratio > 0.3) return NAME_YELLOW;
  return NAME_RED;
}

interface SpriteOpaqueBounds {
  minX: number;
  maxX: number;
  maxY: number;
}

/** Opaque pixel bounds of a cropped atlas frame (for centering on the 32px SQM). */
function opaqueSpriteBounds(texture: Texture): SpriteOpaqueBounds | null {
  const frame = texture.frame;
  const key = ((frame.x * 4099 + frame.y) * 4099 + frame.width) * 31 + frame.height;
  const cached = BOUNDS_CACHE.get(key);
  if (cached) return cached;

  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (!resource || frame.width <= 0 || frame.height <= 0) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(
      resource,
      frame.x, frame.y, frame.width, frame.height,
      0, 0, frame.width, frame.height,
    );
    const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
    let minX = frame.width;
    let maxX = -1;
    let maxY = -1;
    for (let row = 0; row < frame.height; row += 1) {
      const offset = row * frame.width * 4;
      for (let col = 0; col < frame.width; col += 1) {
        if ((pixels[offset + col * 4 + 3] ?? 0) <= 24) continue;
        if (col < minX) minX = col;
        if (col > maxX) maxX = col;
        if (row > maxY) maxY = row;
      }
    }
    if (maxX < 0) return null;
    const bounds = { minX, maxX, maxY };
    BOUNDS_CACHE.set(key, bounds);
    return bounds;
  } catch {
    return null;
  }
}

/**
 * Tibia Global tile sit — feet on the SQM bottom edge, art centered horizontally.
 * Same rules as `sitOnTile` in scenes.ts, adapted for anchor-at-feet containers.
 */
function sitSpriteOnTile(sprite: AnimatedSprite, scaleX = 1): void {
  const frame = sprite.texture.frame;
  const w = frame.width;
  const h = frame.height;
  sprite.anchor.set(0.5, 1);
  const bounds = opaqueSpriteBounds(sprite.texture);
  if (bounds) {
    const centerX = (bounds.minX + bounds.maxX + 1) / 2;
    sprite.x = (w / 2 - centerX) * (scaleX < 0 ? -1 : 1);
    sprite.y = h - (bounds.maxY + 1);
  } else {
    sprite.x = 0;
    sprite.y = Math.max(0, h - TILE);
  }
}

/** First opaque row of the current frame, measured from the feet. */
function visualHeadY(sprite: AnimatedSprite): number {
  const texture = sprite.texture;
  const frame = texture.frame;
  const key = ((frame.x * 4099 + frame.y) * 4099 + frame.width) * 31 + frame.height;
  const cached = HEAD_CACHE.get(key);
  if (cached !== undefined) return -cached;

  const fallback = frame.height >= 48 ? frame.height - 14 : Math.max(20, frame.height);
  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (!resource || frame.width <= 0 || frame.height <= 0) {
    HEAD_CACHE.set(key, fallback);
    return -fallback;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      HEAD_CACHE.set(key, fallback);
      return -fallback;
    }
    ctx.drawImage(
      resource,
      frame.x, frame.y, frame.width, frame.height,
      0, 0, frame.width, frame.height,
    );
    const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
    for (let row = 0; row < frame.height; row += 1) {
      const offset = row * frame.width * 4;
      for (let col = 0; col < frame.width; col += 1) {
        if ((pixels[offset + col * 4 + 3] ?? 0) > 24) {
          const fromFeet = frame.height - row;
          HEAD_CACHE.set(key, fromFeet);
          return -fromFeet;
        }
      }
    }
  } catch {
    // WebGL-only atlas pages cannot be sampled; use the cropped guess.
  }
  HEAD_CACHE.set(key, fallback);
  return -fallback;
}

function drawCave(): Graphics {
  const g = new Graphics();
  const stone = [0x3a3732, 0x2c2a26, 0x45413b, 0x33302b];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      g.rect(x * TILE, y * TILE, TILE, TILE);
      g.fill(stone[(x * 3 + y * 5) % stone.length] ?? 0x33302b);
      g.rect(x * TILE, y * TILE, TILE, 1);
      g.fill(0x1a1816);
    }
  }
  // wooden fence
  for (let x = 1; x < COLS - 1; x += 1) {
    g.rect(x * TILE + 4, TILE + 6, 24, 6);
    g.fill(0x6a4a28);
    g.rect(x * TILE + 4, (ROWS - 2) * TILE + 20, 24, 6);
    g.fill(0x6a4a28);
  }
  for (let y = 2; y < ROWS - 2; y += 1) {
    g.rect(TILE + 6, y * TILE + 4, 6, 24);
    g.fill(0x6a4a28);
    g.rect((COLS - 2) * TILE + 20, y * TILE + 4, 6, 24);
    g.fill(0x6a4a28);
  }
  // campfire
  g.circle(3 * TILE + 16, 8 * TILE + 16, 7);
  g.fill(0xe07030);
  g.circle(3 * TILE + 16, 8 * TILE + 16, 3);
  g.fill(0xffd27a);
  // barrels
  g.roundRect(9 * TILE + 8, 8 * TILE + 6, 16, 20, 3);
  g.fill(0x5a3d22);
  g.roundRect(2 * TILE + 8, 3 * TILE + 6, 16, 20, 3);
  g.fill(0x5a3d22);
  return g;
}

let shared: CombatScene | null = null;
let holds = 0;

/**
 * One Pixi application for the hunt viewport.
 *
 * React Strict Mode mounts, unmounts, and remounts in the same tick. Destroying
 * that first WebGL context used to wipe the shared atlases, so the remount
 * drew an empty cave. Keep the GPU scene alive across that bounce.
 */
export function acquireCombatScene(): CombatScene {
  shared ??= new CombatScene();
  holds += 1;
  return shared;
}

export function releaseCombatScene(scene: CombatScene): void {
  if (shared !== scene) {
    scene.detach();
    scene.destroy();
    return;
  }
  holds = Math.max(0, holds - 1);
  scene.detach();
  queueMicrotask(() => {
    if (holds > 0 || shared !== scene) return;
    scene.destroy();
    if (shared === scene) shared = null;
  });
}
