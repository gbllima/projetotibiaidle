import { AnimatedSprite, Application, Container, Sprite, Text, Texture } from 'pixi.js';
import { DIRECTION_NORTH, GROUP_IDLE, GROUP_MOVING, loadAtlas, type Atlas } from './atlas.js';
import { magicEffectId } from './effects.js';
import { itemSceneTexture } from './itemTexture.js';
import { missileAim, shootEffectId } from './missiles.js';
import { recoloredFrames } from './outfit.js';
import { paintTrainingScene, SCENE_COLS, SCENE_ROWS, SCENE_TILE } from './scenes.js';
import { trainingDummy, trainingRoom, type TrainingRoom } from '../trainingRooms.js';
import type { PlayerView } from './combat.js';
import { VOCATION_LOOK } from './combat.js';

const SCALE = 2;
const DEFAULT_ATTACK_MS = 2000;
const SHOT_MS = 280;

interface TrainingShot {
  sprite: Sprite;
  life: number;
  duration: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  onHit?: () => void;
}

const PLAYER_LABEL = {
  fill: 0x00ff00,
  fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
  fontSize: 9,
  fontWeight: 'bold' as const,
  stroke: { color: 0x000000, width: 3, join: 'round' as const },
  align: 'center' as const,
  padding: 4,
};

function placeholder(color: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 24, 32);
  }
  return Texture.from(canvas);
}

function playerVisualKey(player: PlayerView): string {
  const a = player.appearance;
  return [
    player.name,
    player.vocationId,
    a?.outfit,
    a?.head,
    a?.body,
    a?.legs,
    a?.feet,
    a?.addons,
    a?.mount,
  ].join(':');
}

/** Feet on the SQM bottom edge — root holds world coords, sprite sits locally (combat.ts). */
function placeActorRoot(root: Container, tx: number, ty: number): void {
  root.x = tx * SCENE_TILE + SCENE_TILE / 2;
  root.y = ty * SCENE_TILE + SCENE_TILE;
}

function sitLocalSprite(sprite: Sprite | AnimatedSprite): void {
  sprite.anchor.set(0.5, 1);
  sprite.x = 0;
  const h = sprite.texture.height;
  sprite.y = -Math.max(0, (h - SCENE_TILE) * 0.12);
}

export class TrainingRenderer {
  private app: Application | null = null;
  private floor: Container | null = null;
  private actors: Container | null = null;
  private fx: Container | null = null;
  private tiles: Atlas | null = null;
  private items: Atlas | null = null;
  private outfits: Atlas | null = null;
  private effects: Atlas | null = null;
  private missiles: Atlas | null = null;
  private shots: TrainingShot[] = [];
  private shootEffect: string | null = 'CONST_ANI_ENERGY';
  private player: AnimatedSprite | null = null;
  private playerRoot: Container | null = null;
  private dummyRoots = new Map<string, Container>();
  private targetRoot: Container | null = null;
  private room: TrainingRoom | null = null;
  private currentRoomId: string | null = null;
  private roomToken = 0;
  private attackTimer = 0;
  private attackMs = DEFAULT_ATTACK_MS;
  private playerKey: string | null = null;
  private dead = false;

  alive(): boolean {
    return !this.dead && Boolean(this.app);
  }

  async mount(host: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      width: SCENE_COLS * SCENE_TILE * SCALE,
      height: SCENE_ROWS * SCENE_TILE * SCALE,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      roundPixels: true,
    });
    this.app = app;
    app.canvas.style.imageRendering = 'pixelated';
    host.replaceChildren(app.canvas);
    app.stage.scale.set(SCALE);

    const [tiles, items, outfits, effects, missiles] = await Promise.all([
      loadAtlas('tiles'),
      loadAtlas('items'),
      loadAtlas('outfits'),
      loadAtlas('effects'),
      loadAtlas('missiles').catch(() => null),
    ]);
    this.tiles = tiles;
    this.items = items;
    this.outfits = outfits;
    this.effects = effects;
    this.missiles = missiles;

    const world = new Container();
    this.floor = new Container();
    this.actors = new Container();
    this.fx = new Container();
    world.addChild(this.floor);
    world.addChild(this.actors);
    world.addChild(this.fx);
    app.stage.addChild(world);

    app.ticker.add((ticker) => {
      if (!this.alive()) return;
      this.tickShots(ticker.deltaMS);
      this.attackTimer += ticker.deltaMS;
      if (this.attackTimer >= this.attackMs) {
        this.attackTimer = 0;
        this.swing();
      }
    });
  }

  setShootEffect(shoot: string | null): void {
    this.shootEffect = shoot;
  }

  setCadence(attackMs: number, _exerciseMode?: boolean): void {
    this.attackMs = Math.max(500, attackMs);
    this.attackTimer = 0;
  }

  setRoom(roomId: string, player: PlayerView): void {
    if (!this.alive() || !this.floor || !this.actors || !this.tiles || !this.items) return;
    const room = trainingRoom(roomId) ?? null;
    this.room = room;
    if (!room) {
      this.currentRoomId = null;
      this.clearScene();
      return;
    }

    if (this.currentRoomId === roomId && this.dummyRoots.size > 0) {
      this.updatePlayer(player);
      return;
    }

    this.currentRoomId = roomId;
    const token = ++this.roomToken;
    this.clearScene();
    paintTrainingScene(this.floor, this.tiles, this.items, roomId);
    void this.paintDummies(room, player, token);
  }

  updatePlayer(player: PlayerView): void {
    if (!this.alive() || !this.room || !this.actors) return;
    const key = playerVisualKey(player);
    if (key === this.playerKey && this.playerRoot) return;
    this.playerKey = key;
    if (this.playerRoot) {
      this.playerRoot.destroy({ children: true });
      this.playerRoot = null;
      this.player = null;
    }
    this.spawnPlayer(player, this.room.player.x, this.room.player.y);
  }

  private clearScene(): void {
    this.floor?.removeChildren();
    this.actors?.removeChildren();
    this.fx?.removeChildren();
    this.shots = [];
    this.player = null;
    this.playerRoot = null;
    this.dummyRoots.clear();
    this.targetRoot = null;
    this.playerKey = null;
  }

  private async paintDummies(room: TrainingRoom, player: PlayerView, token: number): Promise<void> {
    const textures = await Promise.all(
      room.placements.map(async (placement) => {
        const def = trainingDummy(placement.dummyId);
        if (!def) return null;
        const texture = await itemSceneTexture(def.itemId);
        return { placement, def, texture };
      }),
    );

    if (!this.alive() || token !== this.roomToken || !this.actors) return;

    for (const entry of textures) {
      if (!entry) continue;
      const root = this.spawnDummy(entry.texture, entry.placement.x, entry.placement.y);
      if (root) this.dummyRoots.set(`${entry.placement.dummyId}-${entry.placement.x}-${entry.placement.y}`, root);
    }

    this.spawnPlayer(player, room.player.x, room.player.y);

    const featuredPlacement = room.placements.find((p) => p.dummyId === room.featuredDummyId);
    const featuredKey = featuredPlacement
      ? `${featuredPlacement.dummyId}-${featuredPlacement.x}-${featuredPlacement.y}`
      : room.featuredDummyId;
    const featuredRoot = this.dummyRoots.get(featuredKey);
    this.targetRoot = featuredRoot ?? this.dummyRoots.values().next().value ?? null;
  }

  private spawnPlayer(player: PlayerView, tx: number, ty: number): void {
    const atlas = this.outfits;
    const look = player.appearance?.outfit ?? VOCATION_LOOK[player.vocationId] ?? 128;
    const direction = DIRECTION_NORTH;
    const appearance = player.appearance;
    const frames = atlas && appearance
      ? recoloredFrames(atlas, look, appearance, direction, GROUP_IDLE)
      : [];
    const moving = atlas?.frames(look, { group: GROUP_MOVING, direction }) ?? { textures: [] };
    const textures = frames.length ? frames : moving.textures.length ? moving.textures : atlas?.icon(look) ? [atlas.icon(look)!] : [placeholder(0x3d8f4a)];

    const sprite = new AnimatedSprite(textures);
    sprite.anchor.set(0.5, 1);
    sprite.animationSpeed = 0.12;
    sprite.play();

    const label = new Text({ text: player.name, style: PLAYER_LABEL, resolution: 2 });
    label.anchor.set(0.5, 1);

    const root = new Container();
    root.addChild(sprite);
    root.addChild(label);
    placeActorRoot(root, tx, ty);
    sitLocalSprite(sprite);
    label.x = 0;
    label.y = sprite.y - sprite.texture.height - 4;
    root.zIndex = Math.round(root.y * 10 + 6);
    this.actors!.sortableChildren = true;
    this.actors!.addChild(root);
    this.player = sprite;
    this.playerRoot = root;
    this.playerKey = playerVisualKey(player);
  }

  private spawnDummy(texture: Texture, tx: number, ty: number): Container | null {
    if (!this.actors) return null;
    const sprite = new Sprite(texture);
    const root = new Container();
    root.addChild(sprite);
    placeActorRoot(root, tx, ty);
    sitLocalSprite(sprite);
    root.zIndex = Math.round(root.y * 10 + 4);
    this.actors.sortableChildren = true;
    this.actors.addChild(root);
    return root;
  }

  private swing(): void {
    if (!this.player || !this.playerRoot || !this.targetRoot || !this.fx || !this.effects) return;
    const tx = this.targetRoot.x;
    const ty = this.targetRoot.y - SCENE_TILE / 2;
    this.player.scale.x = tx >= this.playerRoot.x ? 1 : -1;

    const onHit = () => this.playHitFx(tx, ty);

    if (this.shootEffect) {
      this.launchShot(this.playerRoot, this.targetRoot, this.shootEffect, onHit);
    } else {
      onHit();
    }
  }

  private launchShot(
    from: Container,
    to: Container,
    shoot: string,
    onHit?: () => void,
  ): void {
    if (!this.fx || this.fx.destroyed) {
      onHit?.();
      return;
    }
    const x0 = from.x;
    const y0 = from.y - SCENE_TILE / 2;
    const x1 = to.x;
    const y1 = to.y - SCENE_TILE / 2;
    const id = shootEffectId(shoot);
    try {
      const aim = missileAim(x1 - x0, y1 - y0);
      const frames = id && this.missiles
        ? this.missiles.frames(id, { direction: aim.direction, addon: aim.addon })
        : { textures: [] as Texture[] };
      const texture = frames.textures[0] ?? (id && this.missiles ? this.missiles.icon(id) : null);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = x0;
        sprite.y = y0;
        this.fx.addChild(sprite);
        this.shots.push({ sprite, life: 0, duration: SHOT_MS, x0, y0, x1, y1, onHit });
        return;
      }
      onHit?.();
    } catch (error) {
      console.error('training shot', error);
      onHit?.();
    }
  }

  private tickShots(delta: number): void {
    this.shots = this.shots.filter((shot) => {
      if (shot.sprite.destroyed) {
        try { shot.onHit?.(); } catch { /* gone */ }
        return false;
      }
      shot.life += delta;
      const t = Math.min(1, shot.life / shot.duration);
      shot.sprite.x = shot.x0 + (shot.x1 - shot.x0) * t;
      shot.sprite.y = shot.y0 + (shot.y1 - shot.y0) * t;
      if (t < 1) return true;
      shot.sprite.destroy();
      try { shot.onHit?.(); } catch { /* gone */ }
      return false;
    });
  }

  private playHitFx(tx: number, ty: number): void {
    if (!this.fx || !this.effects) return;

    const effectId = magicEffectId('CONST_ME_POFF');
    if (effectId) {
      const burst = this.effects.frames(effectId);
      if (burst.textures.length) {
        const sprite = new AnimatedSprite(burst.textures);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = tx;
        sprite.y = ty + SCENE_TILE * 0.15;
        sprite.animationSpeed = 0.35;
        sprite.loop = false;
        sprite.alpha = 0.85;
        sprite.onComplete = () => sprite.destroy();
        sprite.play();
        this.fx.addChild(sprite);
      }
    }
  }

  detach(): void {
    this.app?.canvas.remove();
  }

  destroy(): void {
    this.dead = true;
    this.roomToken += 1;
    this.shots = [];
    try { this.app?.destroy(true, { children: true }); } catch { /* gone */ }
    this.app = null;
  }
}

let shared: TrainingRenderer | null = null;
let holds = 0;

export function acquireTrainingScene(): TrainingRenderer {
  shared ??= new TrainingRenderer();
  holds += 1;
  return shared;
}

export function releaseTrainingScene(scene: TrainingRenderer): void {
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
