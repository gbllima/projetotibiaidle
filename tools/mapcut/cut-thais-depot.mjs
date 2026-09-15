/** Extract the depot separately from the fixed-size hunt scenes. Run from repo root. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Stream, parseMapDataAttrs, readItemNode, drainNode } from './cut-hunts.mjs';

const bounds = { x: 32339, y: 32214, width: 19, height: 21, z: 7 };
const raw = fs.readFileSync('servidor/data-global/world/world.otbm');
const data = raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw;
const s = new Stream(data.subarray(4));
if (!s.startNode()) throw new Error('Missing root');
s.skip(1); s.getU32(); s.getU16(); s.getU16(); s.getU32(); s.getU32();
const ground = Array.from({ length: bounds.height }, () => Array(bounds.width).fill(0));
const stack = Array.from({ length: bounds.height }, () => Array.from({ length: bounds.width }, () => []));
if (!s.startNode(2)) throw new Error('Missing map data');
parseMapDataAttrs(s);
while (s.startNode(4)) {
  const bx = s.getU16(), by = s.getU16(), z = s.getU8();
  while (s.startNode()) {
    const type = s.getU8();
    if (type !== 5 && type !== 14) throw new Error(`Unexpected tile ${type}`);
    const x = bx + s.getU8(), y = by + s.getU8();
    if (type === 14) s.getU32();
    let floor = 0;
    if (s.isProp(3)) s.getU32();
    if (s.isProp(9)) floor = s.getU16();
    const items = [];
    while (s.startNode()) {
      const child = s.getU8();
      if (child === 6) readItemNode(s, items);
      else if (child === 19) { const n = s.getU16(); for (let i = 0; i < n; i++) s.getU16(); }
      else drainNode(s);
      if (!s.endNode()) throw new Error('Tile child end');
    }
    if (!s.endNode()) throw new Error('Tile end');
    if (z !== bounds.z || x < bounds.x || y < bounds.y || x >= bounds.x + bounds.width || y >= bounds.y + bounds.height) continue;
    if (!floor && items.length) floor = items.shift();
    ground[y - bounds.y][x - bounds.x] = floor;
    stack[y - bounds.y][x - bounds.x] = items;
  }
  if (!s.endNode()) throw new Error('Area end');
}
const room = { bounds, ground, stack };
fs.writeFileSync('packages/data/generated/thais-depot.json', JSON.stringify(room));
console.log(`Depot: ${bounds.width} x ${bounds.height}, ${ground.flat().filter(Boolean).length} ground tiles`);
