import { AnimatedSprite, Container, Graphics, Sprite } from 'pixi.js';
import { cityTiles, huntMaps, huntsById, type HuntMapRoom } from '@tibia-idle/data';
import { trainingRoom, type TrainingRoom } from '../trainingRooms.js';
import { GROUP_GROUND, type Atlas } from './atlas.js';

export const SCENE_TILE = 32;
export const SCENE_COLS = 13;
export const SCENE_ROWS = 11;

export type HuntTheme =
  | 'cave'
  | 'swamp'
  | 'desert'
  | 'jungle'
  | 'ice'
  | 'sea'
  | 'hell'
  | 'tomb'
  | 'city'
  | 'hive'
  | 'otherworld'
  | 'ruins';

interface ThemeKit {
  floor: number;
  accent: number[];
  water?: number[];
  wallN: number;
  wallE: number;
  wallS: number;
  wallW: number;
  wallNW: number;
  wallNE: number;
  wallSW: number;
  wallSE: number;
  props: number[];
}

const KITS: Record<HuntTheme, ThemeKit> = {
  cave: { floor: 351, accent: [352, 353, 354], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [1780, 1781, 1782, 2921, 3115, 3116] },
  swamp: { floor: 593, accent: [598, 599, 604], water: [605, 606], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [3723, 3724, 3725, 3115, 1781] },
  desert: { floor: 408, accent: [409, 410, 429], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [1780, 1782, 2920, 3114] },
  jungle: { floor: 231, accent: [452, 453, 614], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [37019, 37020, 3723, 3724, 1781] },
  ice: { floor: 799, accent: [800, 837], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [1780, 1782, 2920] },
  sea: { floor: 409, accent: [410, 231], water: [728, 729, 730], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [1781, 3115, 3577] },
  hell: { floor: 1127, accent: [351, 424, 425], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [2921, 2923, 3114, 3116] },
  tomb: { floor: 351, accent: [354, 355, 100], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [3114, 3115, 3116, 2920] },
  city: { floor: 486, accent: [499, 529], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [34300, 2921, 1781] },
  hive: { floor: 1019, accent: [1020, 1021], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [3725, 1781, 3115] },
  otherworld: { floor: 1127, accent: [1019, 880], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [2921, 3114, 1780] },
  ruins: { floor: 351, accent: [486, 100, 104], wallN: 1025, wallE: 1026, wallS: 1027, wallW: 1028, wallNW: 1022, wallNE: 1023, wallSW: 1024, wallSE: 1035, props: [1780, 1782, 3114, 3116] },
};

const THEME_COLOR: Record<HuntTheme, number> = {
  cave: 0x3a2a1a, swamp: 0x2a3a22, desert: 0xc2a46a, jungle: 0x2f5a28,
  ice: 0xa8c8d8, sea: 0x2a5a7a, hell: 0x4a1a12, tomb: 0x3a3428,
  city: 0x5a5a5a, hive: 0x6a5a28, otherworld: 0x3a2858, ruins: 0x4a4030,
};

function paintSolidBase(parent: Container, huntId: string): void {
  const g = new Graphics();
  g.rect(0, 0, SCENE_COLS * SCENE_TILE, SCENE_ROWS * SCENE_TILE);
  g.fill({ color: THEME_COLOR[themeForHunt(huntId)] });
  parent.addChild(g);
}

const COMBAT_CELLS = new Set<string>();
for (let y = 3; y <= 7; y += 1) for (let x = 4; x <= 8; x += 1) COMBAT_CELLS.add(`${x},${y}`);

const DECO_SPOTS = [
  { x: 2, y: 2 }, { x: 10, y: 2 }, { x: 2, y: 8 }, { x: 10, y: 8 },
  { x: 3, y: 2 }, { x: 9, y: 2 }, { x: 1, y: 4 }, { x: 11, y: 4 },
  { x: 1, y: 6 }, { x: 11, y: 6 }, { x: 5, y: 1 }, { x: 7, y: 1 },
  { x: 5, y: 9 }, { x: 7, y: 9 },
];

const THEME_RULES: Array<[RegExp, HuntTheme]> = [
  [/ice|winter|svargrond|barbarian/, 'ice'], [/sea|serpent|water|quara|laguna|sunken|deathling|podzilla/, 'sea'],
  [/lava|fire|infernatil|nether|hell|demonwar|grim.?reaper|roshamuul|warzone|poi.?dt|inquisition/, 'hell'],
  [/swamp|bog.?raid|werecrocodile/, 'swamp'], [/desert|darashia|ankrahmun|nomad|scarab|kha.?labal|kha.?zeel|issavi|sphinx|larva|terramite|lion.?s.?rock/, 'desert'],
  [/jungle|tiquanda|banuta|amazon|carnisylvan|forest|barkless|ape|iksupan|oramond.?hydra|wild.?life/, 'jungle'],
  [/tomb|crypt|cemet|vampire|mumm|haunt|drefia|buried|catacomb|cult|were|putrid|nexus/, 'tomb'],
  [/hive|gray.?island/, 'hive'], [/otherworld|yielothax|nightmare|glooth/, 'otherworld'],
  [/training|dojo|thais-depot/, 'city'], [/ruin|krailos|azzilon|wall|draken/, 'ruins'],
  [/cave|tunnel|mine|rotworm|drill|stone|spike|kazordoon|pirat|antrum|ingol|corym|cyclops|gargoyle/, 'cave'],
];

const LOCATION_THEME: Record<string, HuntTheme> = {
  Svargrond: 'ice', 'Port Hope': 'jungle', Darashia: 'desert', Ankrahmun: 'desert', Issavi: 'desert', Darama: 'desert', "Kha'labal": 'desert', "Kha'zeel": 'desert',
  Tiquanda: 'jungle', Banuta: 'jungle', Amazon: 'jungle', Iksupan: 'jungle', Kazordoon: 'cave', Warzone: 'hell', Spike: 'cave', Roshamuul: 'hell', Lower: 'hell',
  Fire: 'hell', Netherworld: 'hell', Nightmare: 'otherworld', 'Liberty Bay': 'sea', 'Gray Island': 'hive', Podzilla: 'sea', Yalahar: 'city', Oramond: 'otherworld',
  Venore: 'swamp', Carlin: 'jungle', Edron: 'cave', Farmine: 'ruins', Krailos: 'ruins', Drefia: 'tomb', Catacombs: 'tomb', Asura: 'city', Candia: 'cave', Ingol: 'cave',
  Marapur: 'sea', Rascacoon: 'sea', Meriana: 'sea', Northport: 'sea', Ramoa: 'jungle', Stampor: 'jungle', Fenrock: 'hell', Mistrock: 'cave', Summer: 'jungle', Elves: 'jungle', "Ab'Dendriel": 'jungle',
};

export function themeForHunt(huntId: string): HuntTheme {
  if (huntId === 'training-dojo' || huntId === 'thais-depot') return 'city';
  const hunt = huntsById.get(huntId);
  const text = `${huntId} ${hunt?.name ?? ''} ${hunt?.location ?? ''}`.toLowerCase();
  for (const [pattern, theme] of THEME_RULES) if (pattern.test(text)) return theme;
  return (hunt?.location ? LOCATION_THEME[hunt.location] : undefined) ?? 'cave';
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function rng(seed: number): () => number {
  let state = seed || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0xffffffff; };
}

function pick<T>(list: T[], random: () => number): T { return list[Math.floor(random() * list.length) % list.length] as T; }

function isAnimated(atlas: Atlas, id: number): boolean {
  const entry = atlas.entry(id); if (!entry) return false;
  const group = entry.groups[GROUP_GROUND] ?? Object.values(entry.groups)[0];
  return (group?.frames ?? 1) > 1;
}

function groundTexture(atlas: Atlas, id: number, x: number, y: number) {
  const entry = atlas.entry(id); if (!entry) return null;
  const group = entry.groups[GROUP_GROUND] ?? Object.values(entry.groups)[0]; if (!group) return atlas.icon(id);
  const index = atlas.spriteIndex(group, { direction: x % Math.max(1, group.patternWidth), addon: y % Math.max(1, group.patternHeight) });
  return atlas.texture(group.sprites[index] ?? -1) ?? atlas.icon(id);
}

function sitOnTile(sprite: Sprite, tx: number, ty: number): void {
  const width = sprite.texture.width; const height = sprite.texture.height;
  sprite.x = Math.round(tx * SCENE_TILE - Math.max(0, (width - SCENE_TILE) / 2));
  sprite.y = Math.round(ty * SCENE_TILE - Math.max(0, height - SCENE_TILE));
  sprite.roundPixels = true;
}

function snapGroundSprite(sprite: Sprite | AnimatedSprite, x: number, y: number): void {
  sprite.x = x * SCENE_TILE; sprite.y = y * SCENE_TILE; sprite.roundPixels = true; sprite.width = SCENE_TILE + 1; sprite.height = SCENE_TILE + 1;
}

function canPaint(atlas: Atlas, id: number): boolean {
  if (!id || !atlas.entry(id)) return false;
  if (isAnimated(atlas, id)) return atlas.frames(id, { group: GROUP_GROUND }).textures.length > 0;
  return Boolean(groundTexture(atlas, id, 0, 0) ?? atlas.icon(id));
}

function placeGround(layer: Container, atlas: Atlas, id: number, x: number, y: number): boolean {
  if (!id) return false;
  if (isAnimated(atlas, id)) {
    const frames = atlas.frames(id, { group: GROUP_GROUND }); if (!frames.textures.length) return false;
    const sprite = new AnimatedSprite(frames.textures); sprite.animationSpeed = 0.08; sprite.play(); snapGroundSprite(sprite, x, y); layer.addChild(sprite); return true;
  }
  const texture = groundTexture(atlas, id, x, y) ?? atlas.icon(id); if (!texture) return false;
  const sprite = new Sprite(texture); snapGroundSprite(sprite, x, y); layer.addChild(sprite); return true;
}

function placeProp(layer: Container, atlas: Atlas, id: number, x: number, y: number): void {
  if (!id || !canPaint(atlas, id)) return;
  if (isAnimated(atlas, id)) {
    const frames = atlas.frames(id, { group: GROUP_GROUND }); if (!frames.textures.length) return;
    const sprite = new AnimatedSprite(frames.textures); sprite.animationSpeed = 0.1; sprite.play(); sitOnTile(sprite, x, y); layer.addChild(sprite); return;
  }
  const texture = atlas.icon(id) ?? groundTexture(atlas, id, x, y); if (!texture) return;
  const sprite = new Sprite(texture); sitOnTile(sprite, x, y); layer.addChild(sprite);
}

function themeFloorId(atlas: Atlas, huntId: string, x: number, y: number, random: () => number): number {
  const theme = themeForHunt(huntId); const kit = KITS[theme];
  const candidates = [kit.floor, ...kit.accent, 351, 104, 231].filter((id) => canPaint(atlas, id));
  if (!candidates.length) return kit.floor;
  if (theme === 'sea' && kit.water && (y === 0 || y === SCENE_ROWS - 1) && random() < 0.45) { const water = kit.water.find((id) => canPaint(atlas, id)); if (water) return water; }
  if (candidates.length > 1 && random() < 0.08) return pick(candidates.slice(1), random);
  return candidates[0]!;
}

function paintOtbmRoom(parent: Container, tiles: Atlas, room: HuntMapRoom, huntId: string): void {
  paintSolidBase(parent, huntId);
  const random = rng(hashId(huntId) ^ 0x9e3779b9); const floor = new Container(); const props = new Container(); parent.addChild(floor); parent.addChild(props);
  let paintedOtbm = 0;
  for (let y = 0; y < SCENE_ROWS; y += 1) {
    for (let x = 0; x < SCENE_COLS; x += 1) {
      const ground = room.ground[y]?.[x] ?? 0;
      if (ground && canPaint(tiles, ground)) { if (placeGround(floor, tiles, ground, x, y)) paintedOtbm += 1; }
      else placeGround(floor, tiles, themeFloorId(tiles, huntId, x, y, random), x, y);
      for (const itemId of room.stack[y]?.[x] ?? []) placeProp(props, tiles, itemId, x, y);
    }
  }
  if (paintedOtbm < 20) {
    const kit = KITS[themeForHunt(huntId)]; const lastX = SCENE_COLS - 1; const lastY = SCENE_ROWS - 1;
    for (let x = 1; x < lastX; x += 1) { placeProp(props, tiles, kit.wallN, x, 0); placeProp(props, tiles, kit.wallS, x, lastY); }
    for (let y = 1; y < lastY; y += 1) { placeProp(props, tiles, kit.wallW, 0, y); placeProp(props, tiles, kit.wallE, lastX, y); }
  }
}

function paintProceduralRoom(parent: Container, tiles: Atlas, huntId: string): void {
  paintSolidBase(parent, huntId); const theme = themeForHunt(huntId); const kit = KITS[theme]; const random = rng(hashId(huntId));
  const floor = new Container(); const props = new Container(); parent.addChild(floor); parent.addChild(props);
  for (let y = 0; y < SCENE_ROWS; y += 1) for (let x = 0; x < SCENE_COLS; x += 1) placeGround(floor, tiles, themeFloorId(tiles, huntId, x, y, random), x, y);
  const lastX = SCENE_COLS - 1; const lastY = SCENE_ROWS - 1;
  for (let x = 1; x < lastX; x += 1) { placeProp(props, tiles, kit.wallN, x, 0); placeProp(props, tiles, kit.wallS, x, lastY); }
  for (let y = 1; y < lastY; y += 1) { placeProp(props, tiles, kit.wallW, 0, y); placeProp(props, tiles, kit.wallE, lastX, y); }
  placeProp(props, tiles, kit.wallNW, 0, 0); placeProp(props, tiles, kit.wallNE, lastX, 0); placeProp(props, tiles, kit.wallSW, 0, lastY); placeProp(props, tiles, kit.wallSE, lastX, lastY);
  const used = new Set<string>(COMBAT_CELLS); const count = 4 + Math.floor(random() * 3); const spots = DECO_SPOTS.filter((spot) => !used.has(`${spot.x},${spot.y}`));
  for (let i = spots.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); const swap = spots[i]!; spots[i] = spots[j]!; spots[j] = swap; }
  for (const spot of spots.slice(0, count)) placeProp(props, tiles, pick(kit.props, random), spot.x, spot.y);
}

export function paintHuntScene(parent: Container, tiles: Atlas, huntId: string): void {
  const room = huntMaps[huntId];
  if (room && room.filled >= 40) { paintOtbmRoom(parent, tiles, room, huntId); return; }
  paintProceduralRoom(parent, tiles, huntId);
}

/** Render the real Thais Depot cut generated from the project's OTBM map. */
export function paintCityScene(parent: Container, tiles: Atlas): void {
  const ground = new Container();
  const props = new Container();
  parent.addChild(ground, props);
  for (const tile of cityTiles) {
    placeGround(ground, tiles, tile.ground, tile.x, tile.y);
    if (tile.ground === 870 && ground.children.length) ground.children[ground.children.length - 1]!.tint = 0xb49b77;
    for (const id of tile.props) placeProp(props, tiles, id, tile.x, tile.y);
  }
}

const HOUSE_DECO: Record<string, Array<{ id: number; x: number; y: number; ground?: boolean }>> = {
  torch: [{ id: 2921, x: 1, y: 2 }, { id: 2921, x: 11, y: 2 }, { id: 2920, x: 1, y: 8 }, { id: 2920, x: 11, y: 8 }],
  banner: [{ id: 34300, x: 5, y: 1 }, { id: 34300, x: 7, y: 1 }],
  carpet: [{ id: 104, x: 5, y: 8, ground: true }, { id: 104, x: 6, y: 8, ground: true }, { id: 104, x: 7, y: 8, ground: true }],
  fountain: [{ id: 3577, x: 2, y: 8 }], statue: [{ id: 3116, x: 10, y: 8 }],
};

export function paintDecorations(parent: Container, tiles: Atlas, unlocked: string[]): void {
  const layer = new Container(); parent.addChild(layer);
  for (const id of unlocked) for (const spot of HOUSE_DECO[id] ?? []) { if (spot.ground) placeGround(layer, tiles, spot.id, spot.x, spot.y); else placeProp(layer, tiles, spot.id, spot.x, spot.y); }
}

export function placeItem(layer: Container, items: Atlas, id: number, x: number, y: number): void {
  if (!id || !items.has(id)) return; const texture = items.icon(id); if (!texture) return; const sprite = new Sprite(texture); sitOnTile(sprite, x, y); layer.addChild(sprite);
}

export function paintTrainingScene(parent: Container, tiles: Atlas, items: Atlas, roomId: string): TrainingRoom | null {
  const room = trainingRoom(roomId); if (!room) return null;
  paintSolidBase(parent, 'training-dojo'); const kit = KITS.city;
  const stone = canPaint(tiles, 405) ? 405 : kit.floor;
  const wood = canPaint(tiles, 479) ? 479 : (canPaint(tiles, 529) ? 529 : kit.accent[0] ?? kit.floor);
  const floor = new Container(); const groundDeco = new Container(); const props = new Container(); parent.addChild(floor); parent.addChild(groundDeco); parent.addChild(props);
  for (let y = 0; y < SCENE_ROWS; y += 1) for (let x = 0; x < SCENE_COLS; x += 1) placeGround(floor, tiles, (x + y) % 2 === 0 ? stone : wood, x, y);
  const lastX = SCENE_COLS - 1; const lastY = SCENE_ROWS - 1;
  for (let x = 1; x < lastX; x += 1) { placeProp(props, tiles, kit.wallN, x, 0); placeProp(props, tiles, kit.wallS, x, lastY); }
  for (let y = 1; y < lastY; y += 1) { placeProp(props, tiles, kit.wallW, 0, y); placeProp(props, tiles, kit.wallE, lastX, y); }
  placeProp(props, tiles, kit.wallNW, 0, 0); placeProp(props, tiles, kit.wallNE, lastX, 0); placeProp(props, tiles, kit.wallSW, 0, lastY); placeProp(props, tiles, kit.wallSE, lastX, lastY);
  for (const spot of room.props) {
    if (spot.ground) { if (tiles.has(spot.itemId)) placeGround(groundDeco, tiles, spot.itemId, spot.x, spot.y); else placeItem(groundDeco, items, spot.itemId, spot.x, spot.y); }
    else if (tiles.has(spot.itemId)) placeProp(props, tiles, spot.itemId, spot.x, spot.y);
    else placeItem(props, items, spot.itemId, spot.x, spot.y);
  }
  return room;
}
