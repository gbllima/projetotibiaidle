import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '../../..');

export const SERVER = path.join(ROOT, 'servidor');
export const CLIENT = path.join(ROOT, 'cliente pc');

export const PATHS = {
  monsters: path.join(SERVER, 'data-global', 'monster'),
  itemsXml: path.join(SERVER, 'data', 'items', 'items.xml'),
  vocationsXml: path.join(SERVER, 'data', 'XML', 'vocations.xml'),
  imbuementsXml: path.join(SERVER, 'data', 'XML', 'imbuements.xml'),
  stagesLua: path.join(SERVER, 'data', 'stages.lua'),
  charmsLua: path.join(SERVER, 'data', 'scripts', 'systems', 'bestiary_charms.lua'),
  spells: path.join(SERVER, 'data', 'scripts', 'spells'),
  runes: path.join(SERVER, 'data', 'scripts', 'runes'),
  huntingPlaces: path.join(CLIENT, 'assets_unpacked', 'data', 'json', 'hunting_places.json'),
  assetMeta: path.join(ROOT, 'tools', 'extractor', 'out', 'assets'),
  output: path.join(ROOT, 'packages', 'data', 'generated'),
} as const;
