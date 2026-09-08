/**
 * Cut 13×11 hunt rooms from Crystal Server world.otbm (gzip).
 *
 * Uses WayPath.Position from hunting_places.json — same slug ids as datagen.
 *
 *   node tools/mapcut/cut-hunts.mjs
 *
 * Writes:
 *   packages/data/generated/hunt-maps.json
 *   packages/data/generated/hunt-map-ids.json
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OTBM_PATH = path.join(ROOT, 'servidor/data-global/world/world.otbm');
const HUNTS_PATH = path.join(ROOT, 'cliente pc/assets_unpacked/data/json/hunting_places.json');
const OUT_MAPS = path.join(ROOT, 'packages/data/generated/hunt-maps.json');
const OUT_IDS = path.join(ROOT, 'packages/data/generated/hunt-map-ids.json');

const SCENE_COLS = 13;
const SCENE_ROWS = 11;
const HALF_X = Math.floor(SCENE_COLS / 2); // 6
const HALF_Y = Math.floor(SCENE_ROWS / 2); // 5

const NODE_START = 0xfe;
const NODE_END = 0xff;
const NODE_ESCAPE = 0xfd;

const OTBM_MAP_DATA = 2;
const OTBM_TILE_AREA = 4;
const OTBM_TILE = 5;
const OTBM_ITEM = 6;
const OTBM_HOUSETILE = 14;
const OTBM_TILE_ZONE = 19;

const OTBM_ATTR_DESCRIPTION = 1;
const OTBM_ATTR_EXT_FILE = 2;
const OTBM_ATTR_TILE_FLAGS = 3;
const OTBM_ATTR_EXT_SPAWN_MONSTER_FILE = 11;
const OTBM_ATTR_EXT_HOUSE_FILE = 13;
const OTBM_ATTR_EXT_SPAWN_NPC_FILE = 23;
const OTBM_ATTR_EXT_ZONE_FILE = 24;
const OTBM_ATTR_ITEM = 9;

const ATTR_STORE = 1;
const ATTR_ACTION_ID = 4;
const ATTR_UNIQUE_ID = 5;
const ATTR_TEXT = 6;
const ATTR_DESC = 7;
const ATTR_TELE_DEST = 8;
const ATTR_DEPOT_ID = 10;
const ATTR_RUNE_CHARGES = 12;
const ATTR_HOUSEDOORID = 14;
const ATTR_COUNT = 15;
const ATTR_DURATION = 16;
const ATTR_DECAYING_STATE = 17;
const ATTR_WRITTENDATE = 18;
const ATTR_WRITTENBY = 19;
const ATTR_SLEEPERGUID = 20;
const ATTR_SLEEPSTART = 21;
const ATTR_CHARGES = 22;
const ATTR_NAME = 24;
const ATTR_ARTICLE = 25;
const ATTR_PLURALNAME = 26;
const ATTR_WEIGHT = 27;
const ATTR_ATTACK = 28;
const ATTR_DEFENSE = 29;
const ATTR_EXTRADEFENSE = 30;
const ATTR_ARMOR = 31;
const ATTR_HITCHANCE = 32;
const ATTR_SHOOTRANGE = 33;
const ATTR_SPECIAL = 34;
const ATTR_IMBUEMENT_SLOT = 35;
const ATTR_OPENCONTAINER = 36;
const ATTR_CUSTOM_ATTRIBUTES = 37;
const ATTR_QUICKLOOTCONTAINER = 38;
const ATTR_AMOUNT = 39;
const ATTR_TIER = 40;
const ATTR_CUSTOM = 41;
const ATTR_STORE_INBOX_CATEGORY = 42;
const ATTR_OWNER = 43;
const ATTR_OBTAINCONTAINER = 44;

const slug = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

class Stream {
  constructor(buf) {
    this.data = buf;
    this.pos = 0;
    this.nodes = 0;
  }

  eof() {
    return this.pos >= this.data.length;
  }

  back(n = 1) {
    this.pos = Math.max(0, this.pos - n);
  }

  getU8() {
    if (this.pos >= this.data.length) throw new Error('EOF getU8');
    if (this.nodes > 0 && this.data[this.pos] === NODE_ESCAPE) this.pos += 1;
    if (this.pos >= this.data.length) throw new Error('EOF getU8 escape');
    return this.data[this.pos++];
  }

  readEscaped(size) {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) {
      if (this.nodes > 0 && this.pos < this.data.length && this.data[this.pos] === NODE_ESCAPE) {
        this.pos += 1;
      }
      if (this.pos >= this.data.length) throw new Error('EOF read');
      out[i] = this.data[this.pos++];
    }
    return out;
  }

  getU16() {
    return this.readEscaped(2).readUInt16LE(0);
  }

  getU32() {
    return this.readEscaped(4).readUInt32LE(0);
  }

  getU64() {
    return this.readEscaped(8).readBigUInt64LE(0);
  }

  getString() {
    const len = this.getU16();
    if (len === 0) return '';
    if (len >= 8192 || this.pos + len > this.data.length) throw new Error(`bad string ${len}`);
    const s = this.data.subarray(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return s;
  }

  isProp(prop) {
    const v = this.getU8();
    if (v === prop) return true;
    this.back();
    return false;
  }

  startNode(type = 0) {
    const b = this.getU8();
    if (b !== NODE_START) {
      this.back();
      return false;
    }
    if (type === 0) {
      this.nodes += 1;
      return true;
    }
    const t = this.getU8();
    if (t === type) {
      this.nodes += 1;
      return true;
    }
    this.back(); // type
    this.back(); // START
    return false;
  }

  endNode() {
    const b = this.getU8();
    if (b === NODE_END) {
      this.nodes -= 1;
      return true;
    }
    this.back();
    return false;
  }

  skip(n) {
    for (let i = 0; i < n; i += 1) this.getU8();
  }
}

function skipCustomAttributes(stream) {
  const size = Number(stream.getU64());
  for (let i = 0; i < size; i += 1) {
    stream.getString();
    // CustomAttribute: type byte + payload — Crystal uses a small tagged union.
    const kind = stream.getU8();
    if (kind === 1) stream.getString();
    else if (kind === 2) stream.getU64();
    else if (kind === 3) stream.getU8(); // bool as u8 in some builds; fall through safe
    else if (kind === 4) stream.getU64();
    else throw new Error(`custom attr kind ${kind}`);
  }
}

function skipItemAttrs(stream) {
  for (;;) {
    const attr = stream.getU8();
    if (attr === NODE_END || attr === NODE_START) {
      stream.back();
      return;
    }
    switch (attr) {
      case ATTR_STORE:
        stream.getU64();
        break;
      case ATTR_DEPOT_ID:
        stream.getU16();
        break;
      case ATTR_HOUSEDOORID:
      case ATTR_OPENCONTAINER:
      case ATTR_TIER:
      case ATTR_DECAYING_STATE:
      case ATTR_COUNT:
      case ATTR_RUNE_CHARGES:
      case ATTR_HITCHANCE:
      case ATTR_SHOOTRANGE:
        stream.getU8();
        break;
      case ATTR_TELE_DEST:
        stream.getU16();
        stream.getU16();
        stream.getU8();
        break;
      case ATTR_CHARGES:
      case ATTR_ACTION_ID:
      case ATTR_UNIQUE_ID:
      case ATTR_AMOUNT:
      case ATTR_IMBUEMENT_SLOT:
      case ATTR_QUICKLOOTCONTAINER:
      case ATTR_OBTAINCONTAINER:
      case ATTR_STORE_INBOX_CATEGORY:
        stream.getU16();
        break;
      case ATTR_TEXT:
      case ATTR_DESC:
      case ATTR_WRITTENBY:
      case ATTR_NAME:
      case ATTR_ARTICLE:
      case ATTR_PLURALNAME:
      case ATTR_SPECIAL:
        stream.getString();
        break;
      case ATTR_DURATION:
      case ATTR_WEIGHT:
      case ATTR_ATTACK:
      case ATTR_DEFENSE:
      case ATTR_EXTRADEFENSE:
      case ATTR_ARMOR:
      case ATTR_SLEEPERGUID:
      case ATTR_SLEEPSTART:
      case ATTR_OWNER:
        stream.getU32();
        break;
      case ATTR_WRITTENDATE:
        stream.getU64();
        break;
      case ATTR_CUSTOM_ATTRIBUTES:
      case ATTR_CUSTOM:
        skipCustomAttributes(stream);
        break;
      default:
        stream.back();
        return;
    }
  }
}

/** Drain an unknown nested node (already past START+type). */
function drainNode(stream) {
  skipItemAttrs(stream);
  while (stream.startNode()) {
    stream.getU8();
    drainNode(stream);
    if (!stream.endNode()) throw new Error('drain end');
  }
}

function readItemNode(stream, collect) {
  const id = stream.getU16();
  collect.push(id);
  skipItemAttrs(stream);
  while (stream.startNode()) {
    const type = stream.getU8();
    if (type === OTBM_ITEM) readItemNode(stream, collect);
    else drainNode(stream);
    if (!stream.endNode()) throw new Error('item end');
  }
}

function parseMapDataAttrs(stream) {
  for (;;) {
    const attr = stream.getU8();
    switch (attr) {
      case OTBM_ATTR_DESCRIPTION:
      case OTBM_ATTR_EXT_FILE:
      case OTBM_ATTR_EXT_SPAWN_MONSTER_FILE:
      case OTBM_ATTR_EXT_SPAWN_NPC_FILE:
      case OTBM_ATTR_EXT_HOUSE_FILE:
      case OTBM_ATTR_EXT_ZONE_FILE:
        stream.getString();
        break;
      default:
        stream.back();
        return;
    }
  }
}

function tileKey(x, y, z) {
  return `${x},${y},${z}`;
}

function loadTargets() {
  const raw = JSON.parse(fs.readFileSync(HUNTS_PATH, 'utf8'));
  const seen = new Set();
  const hunts = [];
  const needed = new Map(); // key -> { huntIds: Set, lx, ly, lz relative? }

  for (const entry of raw) {
    let id = slug(entry.Name);
    let suffix = 2;
    while (seen.has(id)) id = `${slug(entry.Name)}-${suffix++}`;
    seen.add(id);
    const pos = entry.WayPath?.Position;
    if (!pos || typeof pos.x !== 'number') continue;
    const cx = pos.x | 0;
    const cy = pos.y | 0;
    const cz = pos.z | 0;
    hunts.push({ id, name: entry.Name, x: cx, y: cy, z: cz });
    for (let dy = -HALF_Y; dy <= HALF_Y; dy += 1) {
      for (let dx = -HALF_X; dx <= HALF_X; dx += 1) {
        const key = tileKey(cx + dx, cy + dy, cz);
        let bucket = needed.get(key);
        if (!bucket) {
          bucket = [];
          needed.set(key, bucket);
        }
        bucket.push({ huntId: id, lx: dx + HALF_X, ly: dy + HALF_Y });
      }
    }
  }
  return { hunts, needed };
}

function cut() {
  const t0 = Date.now();
  console.log('loading targets…');
  const { hunts, needed } = loadTargets();
  console.log(`${hunts.length} hunts, ${needed.size} unique tiles`);

  console.log('decompressing OTBM…');
  const gz = fs.readFileSync(OTBM_PATH);
  const data = zlib.gunzipSync(gz);
  console.log(`decompressed ${(data.length / 1e6).toFixed(1)} MB in ${Date.now() - t0}ms`);

  // Skip 4-byte identifier (OTBM or nulls)
  const stream = new Stream(data.subarray(4));

  if (!stream.startNode()) throw new Error('root start');
  stream.skip(1); // root type
  const version = stream.getU32();
  const width = stream.getU16();
  const height = stream.getU16();
  stream.getU32(); // major items
  stream.getU32(); // minor items
  console.log(`OTBM v${version} size ${width}x${height}`);

  const rooms = new Map();
  for (const h of hunts) {
    rooms.set(h.id, {
      id: h.id,
      name: h.name,
      center: { x: h.x, y: h.y, z: h.z },
      ground: Array.from({ length: SCENE_ROWS }, () => Array(SCENE_COLS).fill(0)),
      stack: Array.from({ length: SCENE_ROWS }, () => Array.from({ length: SCENE_COLS }, () => [])),
      filled: 0,
    });
  }

  let tilesHit = 0;
  let areas = 0;
  if (stream.startNode(OTBM_MAP_DATA)) {
    parseMapDataAttrs(stream);
    while (stream.startNode(OTBM_TILE_AREA)) {
      areas += 1;
      const baseX = stream.getU16();
      const baseY = stream.getU16();
      const baseZ = stream.getU8();

      while (stream.startNode()) {
        const tileType = stream.getU8();
        if (tileType !== OTBM_TILE && tileType !== OTBM_HOUSETILE) {
          throw new Error(`bad tile type ${tileType} @ area ${areas}`);
        }
        const ox = stream.getU8();
        const oy = stream.getU8();
        const x = baseX + ox;
        const y = baseY + oy;
        const z = baseZ;

        if (tileType === OTBM_HOUSETILE) stream.getU32();

        let ground = 0;
        const items = [];

        if (stream.isProp(OTBM_ATTR_TILE_FLAGS)) stream.getU32();
        if (stream.isProp(OTBM_ATTR_ITEM)) ground = stream.getU16();

        while (stream.startNode()) {
          const ntype = stream.getU8();
          if (ntype === OTBM_ITEM) {
            readItemNode(stream, items);
          } else if (ntype === OTBM_TILE_ZONE) {
            const count = stream.getU16();
            for (let i = 0; i < count; i += 1) stream.getU16();
          } else {
            drainNode(stream);
          }
          if (!stream.endNode()) throw new Error(`tile child end @ ${x},${y},${z}`);
        }
        if (!stream.endNode()) throw new Error(`tile end @ ${x},${y},${z}`);

        const refs = needed.get(tileKey(x, y, z));
        if (!refs) continue;
        tilesHit += 1;

        let g = ground;
        let stack = items;
        if (!g && stack.length) {
          g = stack[0];
          stack = stack.slice(1);
        }

        for (const ref of refs) {
          const room = rooms.get(ref.huntId);
          if (!room) continue;
          if (room.ground[ref.ly][ref.lx] === 0 && room.stack[ref.ly][ref.lx].length === 0) {
            room.filled += 1;
          }
          room.ground[ref.ly][ref.lx] = g;
          room.stack[ref.ly][ref.lx] = stack.slice(0, 8);
        }
      }
      if (!stream.endNode()) throw new Error(`area end #${areas}`);
    }
    // After tile areas the next byte should be MAP_DATA END (0xFF).
    while (stream.startNode()) {
      const ntype = stream.getU8();
      console.warn(`unexpected mapdata child type=${ntype} @${stream.pos}`);
      try {
        drainNode(stream);
      } catch (err) {
        console.warn(`drain failed for type ${ntype}: ${err.message} — stopping mapdata parse`);
        break;
      }
      if (!stream.endNode()) {
        console.warn(`could not end mapdata child type=${ntype}`);
        break;
      }
    }
    if (!stream.endNode()) {
      const peek = [...stream.data.subarray(stream.pos, Math.min(stream.data.length, stream.pos + 16))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      console.warn(`mapdata end missing @${stream.pos} nodes=${stream.nodes} peek=${peek} areas=${areas} — continuing with partial cut`);
    }
  }
  console.log(`parsed ${areas} tile areas, hit ${tilesHit} needed tiles`);

  const out = {};
  const idSet = new Set();
  let ok = 0;
  for (const h of hunts) {
    const room = rooms.get(h.id);
    if (!room || room.filled < 20) continue;
    ok += 1;
    out[h.id] = {
      center: room.center,
      ground: room.ground,
      stack: room.stack,
      filled: room.filled,
    };
    for (const row of room.ground) for (const id of row) if (id) idSet.add(id);
    for (const row of room.stack) for (const cell of row) for (const id of cell) if (id) idSet.add(id);
  }

  fs.writeFileSync(OUT_MAPS, JSON.stringify(out));
  fs.writeFileSync(OUT_IDS, JSON.stringify([...idSet].sort((a, b) => a - b)));
  console.log(
    `wrote ${ok}/${hunts.length} rooms, ${idSet.size} appearance ids, tilesHit=${tilesHit}, ${Date.now() - t0}ms`,
  );
  console.log(OUT_MAPS);
}

cut();
