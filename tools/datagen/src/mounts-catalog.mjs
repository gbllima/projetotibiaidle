/**
 * Build store mount catalog from servidor mounts.xml + gamestore.lua prices.
 * Output: packages/data/generated/mounts-catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const xmlPath = path.join(root, 'servidor/data/XML/mounts.xml');
const storePath = path.join(root, 'servidor/data/modules/scripts/gamestore/gamestore.lua');
const outPath = path.join(root, 'packages/data/generated/mounts-catalog.json');

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseMountsXml(xml) {
  const mounts = [];
  for (const match of xml.matchAll(/<mount\s+([^>]+)\/>/g)) {
    const attrs = parseAttrs(match[1]);
    const id = Number(attrs.id);
    const clientid = Number(attrs.clientid);
    if (!Number.isFinite(id) || !Number.isFinite(clientid)) continue;
    mounts.push({
      id,
      clientid,
      name: attrs.name ?? `Mount ${id}`,
      premium: attrs.premium === 'yes',
      from: attrs.type ?? 'default',
      speed: Number(attrs.speed ?? 0) || 0,
    });
  }
  // Dedupe by id (keep first)
  const byId = new Map();
  for (const mount of mounts) {
    if (!byId.has(mount.id)) byId.set(mount.id, mount);
  }
  return [...byId.values()];
}

/** Map server mount id → price from gamestore.lua */
function parseGamestorePrices(lua) {
  const byId = new Map();
  const byName = new Map();
  const blocks = lua.split(/\n\s*\{/);
  for (const block of blocks) {
    if (!/type\s*=\s*GameStore\.OfferTypes\.OFFER_TYPE_MOUNT\b/.test(block)) continue;
    const name = block.match(/\bname\s*=\s*"([^"]+)"/)?.[1];
    const price = Number(block.match(/\bprice\s*=\s*(\d+)/)?.[1]);
    const id = Number(block.match(/\bid\s*=\s*(\d+)/)?.[1]);
    if (!Number.isFinite(price)) continue;
    if (Number.isFinite(id)) byId.set(id, price);
    if (name) byName.set(name.toLowerCase(), price);
  }
  return { byId, byName };
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function priceFor(mount, prices) {
  const fromId = prices.byId.get(mount.id);
  if (fromId != null) return fromId;
  const fromName = prices.byName.get(mount.name.toLowerCase());
  if (fromName != null) return fromName;
  if (mount.from === 'store') return 750;
  if (mount.from === 'quest') return 450;
  return 500;
}

const xml = fs.readFileSync(xmlPath, 'utf8');
const lua = fs.readFileSync(storePath, 'utf8');
const mounts = parseMountsXml(xml);
const prices = parseGamestorePrices(lua);

const catalog = mounts
  .map((mount) => ({
    id: `mount_${slug(mount.name)}`,
    name: mount.name,
    coins: priceFor(mount, prices),
    mount: mount.id,
    clientid: mount.clientid,
    premium: mount.premium,
    from: mount.from,
    speed: mount.speed,
  }))
  .sort((a, b) => {
    const rank = (x) => (x.from === 'store' ? 0 : x.from === 'quest' ? 1 : 2);
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.coins - b.coins || a.name.localeCompare(b.name);
  });

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${catalog.length} mounts -> ${outPath}`);
console.log(`gamestore price hits: ${catalog.filter((m) => prices.byId.has(m.mount)).length}`);
console.log('samples:', catalog.slice(0, 8).map((m) => `${m.name}=${m.coins} (id ${m.mount}→${m.clientid})`).join(', '));
