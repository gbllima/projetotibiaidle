import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HUNTS_PATH = path.join(ROOT, 'cliente pc/assets_unpacked/data/json/hunting_places.json');

const target = {
  Name: 'Thais Depot',
  WayPath: {
    Position: { x: 32350, y: 32220, z: 7 },
  },
};

const raw = JSON.parse(fs.readFileSync(HUNTS_PATH, 'utf8'));
if (!Array.isArray(raw)) throw new Error('hunting_places.json must contain an array');

const existing = raw.find((entry) => entry?.Name === target.Name);
if (existing) {
  existing.WayPath = target.WayPath;
  console.log('Thais Depot target already exists; coordinates refreshed.');
} else {
  raw.push(target);
  console.log('Thais Depot target added to hunting_places.json.');
}

fs.writeFileSync(HUNTS_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
console.log('Target: Thais Depot @ 32350,32220,7');
