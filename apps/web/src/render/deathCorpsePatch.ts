import { Container, Sprite, Texture } from 'pixi.js';
import { outfitMatchesGender } from '@tibia-idle/sim';
import type { SimEvent } from '@tibia-idle/sim';
import { CombatScene, type PlayerView } from './combat.js';
import { loadAtlas } from './atlas.js';

/** TFS standard player corpse appearances. */
const MALE_CORPSE_ID = 3058;
const FEMALE_CORPSE_ID = 3065;
const CORPSE_LIFETIME_MS = 6_000;
const CORPSE_FADE_AT_MS = 4_500;

type SceneRoot = Container & { destroyed?: boolean };

type SceneEntry = {
  root: SceneRoot;
  sprite: { texture: Texture; visible: boolean };
  characterId?: number;
  appearance?: PlayerView['appearance'];
  lastHealth: number;
};

type SceneInternals = {
  actors: Container | null;
  player: SceneEntry | null;
  allies: Map<string, SceneEntry>;
  cityLobby: boolean;
  huntId: string;
};

type SceneSync = (
  this: SceneInternals,
  active: unknown[],
  player: PlayerView,
  allies?: PlayerView[],
) => void;

type PlayOne = (this: SceneInternals, event: SimEvent) => void;
type ResetViewport = (this: SceneInternals) => void;
type SetHunt = (this: SceneInternals, huntId: string) => void;
type SetCityLobby = (this: SceneInternals) => void;

type CombatPrototype = {
  playOne: PlayOne;
  sync: SceneSync;
  resetViewport: ResetViewport;
  setHunt: SetHunt;
  setCityLobby: SetCityLobby;
  __deathCorpsePatchApplied?: boolean;
};

type CorpseRecord = {
  sprite: Sprite;
  fadeTimer: number;
  removeTimer: number;
};

const records = new WeakMap<object, CorpseRecord[]>();
const deathKeys = new WeakMap<object, Set<string>>();
const lethalPartyMembers = new WeakMap<object, Set<number>>();
let itemAtlasPromise: ReturnType<typeof loadAtlas> | null = null;

function sceneKey(scene: SceneInternals): object {
  return scene as object;
}

function corpseRecords(scene: SceneInternals): CorpseRecord[] {
  const key = sceneKey(scene);
  let list = records.get(key);
  if (!list) {
    list = [];
    records.set(key, list);
  }
  return list;
}

function seenDeaths(scene: SceneInternals): Set<string> {
  const key = sceneKey(scene);
  let set = deathKeys.get(key);
  if (!set) {
    set = new Set<string>();
    deathKeys.set(key, set);
  }
  return set;
}

function lethalMembers(scene: SceneInternals): Set<number> {
  const key = sceneKey(scene);
  let set = lethalPartyMembers.get(key);
  if (!set) {
    set = new Set<number>();
    lethalPartyMembers.set(key, set);
  }
  return set;
}

function clearCorpses(scene: SceneInternals): void {
  for (const record of corpseRecords(scene)) {
    window.clearTimeout(record.fadeTimer);
    window.clearTimeout(record.removeTimer);
    try { record.sprite.destroy(); } catch { /* already removed */ }
  }
  records.set(sceneKey(scene), []);
  seenDeaths(scene).clear();
  lethalMembers(scene).clear();
}

function genderFromEntry(entry: SceneEntry): 'm' | 'f' {
  const look = entry.appearance?.outfit ?? 0;
  if (look > 0) {
    const female = outfitMatchesGender(look, 'f');
    const male = outfitMatchesGender(look, 'm');
    if (female && !male) return 'f';
  }
  return 'm';
}

function allyById(scene: SceneInternals, id: number): SceneEntry | undefined {
  return [...scene.allies.values()].find((entry) => entry.characterId === id);
}

function entryForDeath(scene: SceneInternals, event: SimEvent): SceneEntry | null {
  if (event.actorId !== undefined) {
    const ally = allyById(scene, event.actorId);
    if (ally) return ally;
  }
  return scene.player;
}

async function playerCorpseTexture(entry: SceneEntry): Promise<Texture | null> {
  try {
    itemAtlasPromise ??= loadAtlas('items');
    const atlas = await itemAtlasPromise;
    const id = genderFromEntry(entry) === 'f' ? FEMALE_CORPSE_ID : MALE_CORPSE_ID;
    return atlas.icon(id);
  } catch {
    return null;
  }
}

function removeRecord(scene: SceneInternals, sprite: Sprite): void {
  const list = corpseRecords(scene);
  const index = list.findIndex((record) => record.sprite === sprite);
  if (index >= 0) list.splice(index, 1);
}

function spawnCorpse(scene: SceneInternals, entry: SceneEntry, key: string): void {
  if (scene.cityLobby || !scene.actors || scene.actors.destroyed) return;
  const seen = seenDeaths(scene);
  if (seen.has(key)) return;
  seen.add(key);

  // Capture the SQM before sync removes the dead actor from the scene.
  const x = entry.root.x;
  const y = entry.root.y;
  const fallbackTexture = entry.sprite.texture;
  entry.root.visible = false;

  void playerCorpseTexture(entry).then((corpseTexture) => {
    const actors = scene.actors;
    if (!actors || actors.destroyed || scene.cityLobby) return;

    const sprite = new Sprite(corpseTexture ?? fallbackTexture);
    sprite.roundPixels = true;
    sprite.x = Math.round(x);
    sprite.y = Math.round(y);
    sprite.zIndex = Math.round(y * 10 + 2);

    if (corpseTexture) {
      // Real Tibia corpse object: keep its floor orientation untouched.
      sprite.anchor.set(0.5, 1);
    } else {
      // Graceful fallback for an old atlas that has not been regenerated yet.
      // Once items 3058/3065 are present this branch is never used.
      sprite.anchor.set(0.5, 0.5);
      sprite.y -= 10;
      sprite.rotation = Math.PI / 2;
      sprite.tint = 0x8c8c8c;
      sprite.alpha = 0.78;
    }

    actors.addChild(sprite);

    const record: CorpseRecord = {
      sprite,
      fadeTimer: window.setTimeout(() => {
        if (!sprite.destroyed) sprite.alpha = Math.min(sprite.alpha, 0.42);
      }, CORPSE_FADE_AT_MS),
      removeTimer: window.setTimeout(() => {
        removeRecord(scene, sprite);
        try { sprite.destroy(); } catch { /* already removed */ }
      }, CORPSE_LIFETIME_MS),
    };
    corpseRecords(scene).push(record);
  });
}

const prototype = CombatScene.prototype as unknown as CombatPrototype;

if (!prototype.__deathCorpsePatchApplied) {
  const originalPlayOne = prototype.playOne;
  prototype.playOne = function patchedDeathEvent(this: SceneInternals, event: SimEvent): void {
    // Secondary party sessions do not currently forward player_death itself, but
    // they do forward the final incoming damage with actorId. Mark only genuinely
    // lethal combat removals so manually disabling a party member never leaves a corpse.
    if ((event.type === 'monster_attack' || event.type === 'condition') && event.actorId !== undefined) {
      const ally = allyById(this, event.actorId);
      const damage = Math.max(0, event.amount ?? 0);
      if (ally && damage > 0 && damage >= Math.max(1, ally.lastHealth)) {
        lethalMembers(this).add(event.actorId);
      }
    }

    if (event.type === 'player_death') {
      const entry = entryForDeath(this, event);
      if (entry) {
        const key = event.actorId !== undefined ? `character:${event.actorId}` : 'principal';
        spawnCorpse(this, entry, key);
      }
    }
    originalPlayOne.call(this, event);
  };

  const originalSync = prototype.sync;
  prototype.sync = function patchedDeathSync(
    this: SceneInternals,
    active: unknown[],
    player: PlayerView,
    allies: PlayerView[] = [],
  ): void {
    if (!this.cityLobby) {
      const incomingNames = new Set(allies.map((ally) => ally.name));
      const lethal = lethalMembers(this);
      for (const [name, entry] of this.allies) {
        // A party member that disappears after a lethal server hit died. Leave
        // the corpse on the last known SQM before normal sync destroys the actor.
        if (
          !incomingNames.has(name)
          && entry.characterId !== undefined
          && lethal.has(entry.characterId)
        ) {
          spawnCorpse(this, entry, `character:${entry.characterId}`);
          lethal.delete(entry.characterId);
        }
      }
    }
    originalSync.call(this, active, player, allies);
  };

  const originalResetViewport = prototype.resetViewport;
  prototype.resetViewport = function patchedCorpseReset(this: SceneInternals): void {
    clearCorpses(this);
    originalResetViewport.call(this);
  };

  const originalSetHunt = prototype.setHunt;
  prototype.setHunt = function patchedCorpseSetHunt(this: SceneInternals, huntId: string): void {
    const freshScene = this.cityLobby || this.huntId !== huntId;
    if (freshScene) clearCorpses(this);
    originalSetHunt.call(this, huntId);
  };

  const originalSetCityLobby = prototype.setCityLobby;
  prototype.setCityLobby = function patchedCorpseCity(this: SceneInternals): void {
    clearCorpses(this);
    originalSetCityLobby.call(this);
  };

  prototype.__deathCorpsePatchApplied = true;
}
