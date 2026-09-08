import fs from 'node:fs';
import path from 'node:path';
import { SERVER } from './paths.js';

/**
 * NPC shop prices.
 *
 * items.xml carries no economic value at all, so gold comes from the shop
 * tables the server ships, all written in one uniform line format:
 *
 *   { itemName = "crowbar", clientId = 3304, buy = 260, sell = 50 },
 *
 * Two sources feed this: the per-NPC tables under data-global/npc/, and
 * scripts/lib/shops.lua, which holds the supply-stash and loot-pouch lists.
 * The latter covers staples the individual NPCs miss - great mana potion, for
 * one, which no scraped NPC sells.
 *
 * A player sells to whoever pays most and buys from whoever charges least, so
 * we keep the best price on each side.
 */

export interface Price {
  itemId: number;
  name: string;
  /** Best price a player can sell for, or null if nobody buys it. */
  sell: number | null;
  /** Cheapest price a player can buy at, or null if nobody sells it. */
  buy: number | null;
}

/**
 * Currency values. Coins are never in a shop table because the engine treats
 * them as money, but the loot analyser needs them.
 */
const CURRENCY: Record<number, number> = {
  3031: 1,     // gold coin
  3035: 100,   // platinum coin
  3043: 10000, // crystal coin
};

const ENTRY = /\{\s*itemName\s*=\s*"([^"]+)"\s*,\s*clientId\s*=\s*(\d+)([^}]*)\}/g;
const BUY = /\bbuy\s*=\s*(\d+)/;
const SELL = /\bsell\s*=\s*(\d+)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.lua')) out.push(full);
  }
  return out;
}

export function parsePrices(): { prices: Price[]; npcFiles: number } {
  const dir = path.join(SERVER, 'data-global', 'npc');
  const files = walk(dir);

  const shops = path.join(SERVER, 'data', 'scripts', 'lib', 'shops.lua');
  if (fs.existsSync(shops)) files.push(shops);

  const byId = new Map<number, Price>();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(ENTRY)) {
      const name = match[1] ?? '';
      const itemId = Number.parseInt(match[2] ?? '0', 10);
      const rest = match[3] ?? '';
      if (!itemId) continue;

      const buy = BUY.exec(rest);
      const sell = SELL.exec(rest);
      const buyValue = buy ? Number.parseInt(buy[1] ?? '0', 10) : null;
      const sellValue = sell ? Number.parseInt(sell[1] ?? '0', 10) : null;

      const existing = byId.get(itemId);
      if (!existing) {
        byId.set(itemId, { itemId, name, sell: sellValue, buy: buyValue });
        continue;
      }
      if (sellValue !== null && (existing.sell === null || sellValue > existing.sell)) existing.sell = sellValue;
      if (buyValue !== null && (existing.buy === null || buyValue < existing.buy)) existing.buy = buyValue;
    }
  }

  for (const [itemId, value] of Object.entries(CURRENCY)) {
    const id = Number(itemId);
    const existing = byId.get(id);
    if (existing) existing.sell = Math.max(existing.sell ?? 0, value);
    else byId.set(id, { itemId: id, name: 'currency', sell: value, buy: value });
  }

  return {
    prices: [...byId.values()].sort((a, b) => a.itemId - b.itemId),
    npcFiles: files.length,
  };
}
