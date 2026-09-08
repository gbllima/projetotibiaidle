/**
 * Build store outfit catalog from servidor outfits.xml + gamestore.lua prices.
 * Output: packages/data/generated/outfits-catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const xmlPath = path.join(root, 'servidor/data/XML/outfits.xml');
const storePath = path.join(root, 'servidor/data/modules/scripts/gamestore/gamestore.lua');
const outPath = path.join(root, 'packages/data/generated/outfits-catalog.json');

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseOutfitsXml(xml) {
  const byName = new Map();
  for (const match of xml.matchAll(/<outfit\s+([^>]+)\/>/g)) {
    const attrs = parseAttrs(match[1]);
    if (attrs.enabled === 'no') continue;
    const name = attrs.name;
    if (!name) continue;
    const entry = byName.get(name) ?? {
      name,
      premium: attrs.premium === 'yes',
      from: attrs.from ?? 'default',
      unlocked: attrs.unlocked === 'yes',
      male: null,
      female: null,
    };
    if (attrs.premium === 'yes') entry.premium = true;
    if (attrs.from) entry.from = attrs.from;
    if (attrs.unlocked === 'yes') entry.unlocked = true;
    const look = Number(attrs.looktype);
    if (attrs.type === '1') entry.male = look;
    else entry.female = look;
    byName.set(name, entry);
  }
  return [...byName.values()].filter((entry) => entry.male || entry.female);
}

/** Pull Full Outfit offers from gamestore.lua (name → price, look pair → price). */
function parseGamestorePrices(lua) {
  const prices = new Map();
  const blocks = lua.split(/\n\s*\{/);
  for (const block of blocks) {
    if (!/type\s*=\s*GameStore\.OfferTypes\.OFFER_TYPE_OUTFIT\b/.test(block)) continue;
    if (block.includes('OFFER_TYPE_OUTFIT_ADDON')) continue;
    const name = block.match(/\bname\s*=\s*"([^"]+)"/)?.[1];
    const price = Number(block.match(/\bprice\s*=\s*(\d+)/)?.[1]);
    const female = Number(block.match(/\bfemale\s*=\s*(\d+)/)?.[1]);
    const male = Number(block.match(/\bmale\s*=\s*(\d+)/)?.[1]);
    if (!name || !Number.isFinite(price)) continue;
    const clean = name
      .replace(/^Full\s+/i, '')
      .replace(/\s+Outfit$/i, '')
      .trim()
      .toLowerCase();
    prices.set(clean, price);
    prices.set(name.toLowerCase(), price);
    if (male && female) {
      prices.set(`${male}:${female}`, price);
      prices.set(`${female}:${male}`, price);
    }
  }
  return prices;
}

const PREVIEW_COLORS = [
  { head: 78, body: 94, legs: 114, feet: 115 },
  { head: 95, body: 113, legs: 39, feet: 115 },
  { head: 0, body: 86, legs: 87, feet: 95 },
  { head: 114, body: 120, legs: 114, feet: 115 },
  { head: 3, body: 70, legs: 95, feet: 115 },
  { head: 58, body: 22, legs: 24, feet: 76 },
  { head: 132, body: 76, legs: 95, feet: 114 },
  { head: 10, body: 19, legs: 69, feet: 95 },
  { head: 39, body: 57, legs: 76, feet: 95 },
  { head: 77, body: 128, legs: 114, feet: 0 },
];

/** Classic starter / free outfits stay cheap. */
const STARTER_PRICES = {
  citizen: 50,
  hunter: 80,
  mage: 80,
  knight: 80,
  nobleman: 150,
  noblewoman: 150,
  summoner: 120,
  warrior: 120,
  barbarian: 150,
  druid: 150,
  wizard: 150,
  oriental: 150,
  jersey: 100,
  recruiter: 100,
};

function priceFor(entry, storePrices) {
  const key = entry.name.toLowerCase();
  if (STARTER_PRICES[key] != null) return STARTER_PRICES[key];

  const byLook =
    entry.male && entry.female
      ? storePrices.get(`${entry.male}:${entry.female}`)
      : undefined;
  if (byLook != null) return byLook;

  const exact =
    storePrices.get(key)
    ?? storePrices.get(`full ${key}`)
    ?? storePrices.get(`${key} outfit`)
    ?? storePrices.get(`full ${key} outfit`);
  if (exact != null) return exact;

  if (entry.from === 'store') return 600;
  if (entry.from === 'quest') return 400;
  if (entry.premium) return 200;
  return 100;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const xml = fs.readFileSync(xmlPath, 'utf8');
const lua = fs.readFileSync(storePath, 'utf8');
const outfits = parseOutfitsXml(xml);
const storePrices = parseGamestorePrices(lua);

const catalog = outfits
  .map((entry, index) => {
    const coins = priceFor(entry, storePrices);
    const colors = PREVIEW_COLORS[index % PREVIEW_COLORS.length];
    const look = entry.male ?? entry.female;
    return {
      id: `outfit_${slug(entry.name)}`,
      name: entry.name,
      coins,
      male: entry.male,
      female: entry.female,
      outfit: look,
      premium: entry.premium,
      from: entry.from,
      unlocked: entry.unlocked,
      colors,
    };
  })
  .sort((a, b) => {
    const rank = (x) => {
      if (STARTER_PRICES[x.name.toLowerCase()] != null) return 0;
      if (x.from === 'store') return 1;
      if (x.from === 'quest') return 2;
      return 3;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.coins - b.coins || a.name.localeCompare(b.name);
  });

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${catalog.length} outfits -> ${outPath}`);
console.log('price samples:', catalog.slice(0, 12).map((o) => `${o.name}=${o.coins}`).join(', '));
console.log('store priced:', catalog.filter((o) => o.from === 'store').slice(0, 8).map((o) => `${o.name}=${o.coins}`).join(', '));
