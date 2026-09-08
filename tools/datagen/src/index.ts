import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.js';
import { parseMonsters, type Monster } from './monsters.js';
import { parseItems, mergeAppearanceFlags, type Item } from './items.js';
import { parseVocations } from './vocations.js';
import { parseHunts, type Hunt } from './hunts.js';
import { parseCharms, parseStages, preyBonuses } from './systems.js';
import { parsePrices } from './prices.js';

/**
 * Converts the OTServer's Lua/XML content into typed JSON for packages/data.
 *
 * Everything here is deterministic and reproducible: `pnpm datagen` regenerates
 * from scratch. The generated JSON is committed so the build never depends on
 * having the OTServer checkout present.
 */

const t0 = Date.now();
const log = (msg: string) => console.log(`${String(Date.now() - t0).padStart(6)}ms  ${msg}`);

function write(name: string, data: unknown): number {
  const file = path.join(PATHS.output, name);
  const json = JSON.stringify(data);
  fs.writeFileSync(file, json);
  return json.length;
}

interface AssetEntry {
  name?: string;
  stackable?: boolean;
  marketCategory?: number;
}

function readAssetEntries(file: string): Record<string, AssetEntry> {
  const full = path.join(PATHS.assetMeta, file);
  if (!fs.existsSync(full)) {
    console.warn(`  ! ${file} missing - run tools/extractor/extract.py first`);
    return {};
  }
  return (JSON.parse(fs.readFileSync(full, 'utf8')) as { entries: Record<string, AssetEntry> }).entries;
}

/**
 * Cross-checks that catch content gaps before they become runtime bugs.
 *
 * Blocking problems break the game (a hunt referencing a monster we cannot
 * spawn or draw). Warnings are survivable gaps we degrade around.
 */
function validate(monsters: Monster[], items: Item[], hunts: Hunt[], creatureLookTypes: Set<number>) {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(monsters.map((m) => [m.id, m]));
  const itemsByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));

  const missingMonsters = new Set<string>();
  for (const hunt of hunts) {
    for (const name of hunt.monsters) {
      if (!byId.has(name)) missingMonsters.add(name);
    }
  }
  if (missingMonsters.size) {
    blocking.push(`${missingMonsters.size} hunt monsters have no monster data: ${[...missingMonsters].slice(0, 5).join(', ')}`);
  }

  const huntMonsters = new Set(hunts.flatMap((h) => h.monsters));
  const noSprite = [...huntMonsters]
    .map((id) => byId.get(id))
    .filter((m): m is Monster => Boolean(m))
    .filter((m) => m.lookType !== null && !creatureLookTypes.has(m.lookType));
  if (noSprite.length) {
    blocking.push(`${noSprite.length} hunt monsters have no sprite: ${noSprite.slice(0, 5).map((m) => m.name).join(', ')}`);
  }

  // Loot names that resolve to nothing are dropped at generation time, so the
  // game never sees them. Worth reporting, not worth failing over.
  const unknownLoot = new Set<string>();
  for (const monster of monsters) {
    if (!huntMonsters.has(monster.id)) continue;
    for (const drop of monster.loot) {
      if (drop.itemName && !itemsByName.has(drop.itemName.toLowerCase())) unknownLoot.add(drop.itemName);
    }
  }
  if (unknownLoot.size) {
    warnings.push(`${unknownLoot.size} loot names resolve to no item (dropped): ${[...unknownLoot].slice(0, 5).join(', ')}`);
  }

  return { blocking, warnings, huntMonsterCount: huntMonsters.size, unknownLoot };
}

async function main() {
  fs.mkdirSync(PATHS.output, { recursive: true });
  const sizes: Record<string, number> = {};

  log('parsing monsters (Lua VM)...');
  const { monsters, errors, duplicates, fileCount } = await parseMonsters();
  log(`  ${fileCount} files -> ${monsters.length} monsters, ${errors.length} errors, ${duplicates.length} duplicate names`);
  for (const error of errors.slice(0, 10)) console.warn(`  ! ${error}`);

  log('parsing items.xml (stream)...');
  const items = await parseItems();
  log(`  ${items.length} items`);

  log('parsing vocations, hunts, charms, stages...');
  const vocations = await parseVocations();
  const hunts = parseHunts();
  const charms = await parseCharms();
  const stages = await parseStages();
  log(`  ${vocations.length} vocations, ${hunts.length} hunts, ${charms.length} charms`);

  log('parsing NPC shop prices...');
  const { prices, npcFiles } = parsePrices();
  const priceById = new Map(prices.map((p) => [p.itemId, p]));
  let priced = 0;
  for (const item of items) {
    const price = priceById.get(item.id);
    if (!price) continue;
    item.sellPrice = price.sell;
    item.buyPrice = price.buy;
    if (price.sell !== null) priced += 1;
  }
  log(`  ${npcFiles} NPC files -> ${prices.length} traded items, ${priced} sellable`);

  log('merging client appearance flags...');
  const creatureEntries = readAssetEntries('creatures.json');
  const itemEntries = readAssetEntries('items.json');
  const merged = mergeAppearanceFlags(items, itemEntries);
  const iconManifestPath = path.join(PATHS.assetMeta, 'item-icons.json');
  if (fs.existsSync(iconManifestPath)) {
    const iconManifest = JSON.parse(fs.readFileSync(iconManifestPath, 'utf8')) as Record<string, { clientId?: number }>;
    let patched = 0;
    for (const item of items) {
      const row = iconManifest[String(item.id)];
      if (!row) continue;
      item.hasSprite = true;
      if (item.clientId == null) item.clientId = row.clientId ?? item.id;
      patched += 1;
    }
    log(`  ${patched} items linked to standalone item-icons`);
  }
  const creatureLookTypes = new Set(Object.keys(creatureEntries).map(Number));
  log(`  ${merged.withSprite} items matched a sprite (${merged.byName} by name), ${merged.stackable} stackable`);

  log('validating cross-references...');
  const { blocking, warnings, huntMonsterCount, unknownLoot } = validate(monsters, items, hunts, creatureLookTypes);
  if (blocking.length === 0) log('  no blocking problems');
  for (const problem of blocking) console.error(`  X ${problem}`);
  for (const warning of warnings) console.warn(`  ! ${warning}`);

  // Loot is declared by name in some files and by id in others. Resolve both
  // to an id so the simulation has a single lookup key, and drop entries that
  // resolve to nothing.
  log('resolving loot references...');
  const itemsByName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  let resolved = 0;
  let dropped = 0;
  for (const monster of monsters) {
    monster.loot = monster.loot.filter((drop) => {
      const item = drop.itemId !== null ? itemsById.get(drop.itemId) : itemsByName.get((drop.itemName ?? '').toLowerCase());
      if (!item) { dropped += 1; return false; }
      drop.itemId = item.id;
      drop.itemName = item.name;
      resolved += 1;
      return true;
    });
  }
  log(`  ${resolved} loot entries resolved, ${dropped} dropped`);

  // Ship the full Crystal catalog so the Cyclopedia matches client coverage.
  // Gameplay still only *uses* loot / shop / equippable rows; the rest are browse-only.
  const reachable = new Set<number>();
  for (const monster of monsters) {
    for (const drop of monster.loot) if (drop.itemId !== null) reachable.add(drop.itemId);
  }
  const gameItems = items;
  const playableCount = items.filter((i) => {
    const traded = i.buyPrice !== null || i.sellPrice !== null;
    if (traded) return true;
    return i.hasSprite && (reachable.has(i.id) || i.marketCategory !== null || i.slot !== null);
  }).length;

  log(`  shipping ${gameItems.length} items (${playableCount} playable / loot / shop)`);

  log('writing...');
  sizes['monsters.json'] = write('monsters.json', monsters);
  sizes['items.json'] = write('items.json', gameItems);
  sizes['hunts.json'] = write('hunts.json', hunts);
  sizes['vocations.json'] = write('vocations.json', vocations);
  sizes['charms.json'] = write('charms.json', charms);
  sizes['stages.json'] = write('stages.json', stages);
  sizes['prey.json'] = write('prey.json', preyBonuses());

  const meta = {
    generatedAt: new Date().toISOString(),
    source: { protocol: '15.25', server: 'Crystal Server' },
    counts: {
      monsters: monsters.length,
      monsterFiles: fileCount,
      itemsParsed: items.length,
      itemsShipped: gameItems.length,
      itemsPlayable: playableCount,
      hunts: hunts.length,
      huntMonsters: huntMonsterCount,
      vocations: vocations.length,
      charms: charms.length,
      pricedItems: priced,
    },
    warnings: { parseErrors: errors, duplicateNames: duplicates.length, validation: [...blocking, ...warnings] },
  };
  sizes['meta.json'] = write('meta.json', meta);

  console.log('');
  for (const [name, bytes] of Object.entries(sizes)) {
    console.log(`  ${name.padEnd(18)} ${(bytes / 1024).toFixed(0).padStart(6)} KB`);
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`  ${'total'.padEnd(18)} ${(total / 1024 / 1024).toFixed(1).padStart(6)} MB`);
  log('done');

  if (blocking.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
