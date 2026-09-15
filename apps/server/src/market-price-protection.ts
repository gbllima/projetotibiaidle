import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { itemsById } from '@tibia-idle/data';
import type { Database } from './db.js';

const ABSOLUTE_MIN_GOLD = 10;
const MARKET_HISTORY_KEY = 'market:v2:history';
const RECENT_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIAN_FLOOR_RATIO = 0.25;
const LOW_PRICE_WARNING_RATIO = 0.50;

type TradeHistoryEntry = {
  itemId?: number;
  unitPrice?: number;
  at?: number;
};

export type MarketPriceRule = {
  itemId: number;
  itemName: string;
  npcPrice: number;
  medianRecentPrice: number;
  recentTrades: number;
  minAllowedPrice: number;
  warningBelowPrice: number;
};

function recentTradePrices(db: Database, itemId: number, now = Date.now()): number[] {
  const raw = db.getWorld(MARKET_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TradeHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = now - RECENT_HISTORY_MS;
    return parsed
      .filter((entry) => Number(entry.itemId) === itemId && Number(entry.at) >= cutoff)
      .map((entry) => Math.floor(Number(entry.unitPrice)))
      .filter((price) => Number.isFinite(price) && price > 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] ?? 0;
  return Math.round(((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2);
}

export function marketPriceRule(db: Database, itemId: number, now = Date.now()): MarketPriceRule | null {
  const item = itemsById.get(itemId);
  if (!item) return null;
  const npcPrice = Math.max(0, Math.floor(item.sellPrice ?? 0));
  const prices = recentTradePrices(db, itemId, now);
  const medianRecentPrice = median(prices);
  const historyFloor = medianRecentPrice > 0 ? Math.ceil(medianRecentPrice * MEDIAN_FLOOR_RATIO) : 0;
  const warningBelowPrice = medianRecentPrice > 0 ? Math.ceil(medianRecentPrice * LOW_PRICE_WARNING_RATIO) : 0;
  return {
    itemId,
    itemName: item.name,
    npcPrice,
    medianRecentPrice,
    recentTrades: prices.length,
    minAllowedPrice: Math.max(ABSOLUTE_MIN_GOLD, npcPrice, historyFloor),
    warningBelowPrice,
  };
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ error });
}

/**
 * Server-side source of truth for Market V2 price floors.
 * The UI also shows the rule, but direct API calls cannot bypass it.
 */
export function registerMarketPriceProtection(app: FastifyInstance, db: Database): void {
  app.get('/api/market-price-protection/:itemId', async (request, reply) => {
    const itemId = Number((request.params as { itemId?: string }).itemId);
    const rule = marketPriceRule(db, itemId);
    if (!rule) return fail(reply, 404, 'Item não encontrado.');
    return rule;
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST' || !/^\/api\/market-v2\/\d+\/list(?:\?|$)/.test(request.url)) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const itemId = Number(body['itemId']);
    const unitPrice = Math.floor(Number(body['unitPrice']));
    const rule = marketPriceRule(db, itemId);
    if (!rule || !Number.isFinite(unitPrice)) return;
    if (unitPrice >= rule.minAllowedPrice) return;

    const reference = rule.medianRecentPrice > 0
      ? ` A mediana recente é ${rule.medianRecentPrice.toLocaleString('pt-BR')} gold.`
      : '';
    return fail(
      reply,
      400,
      `Preço muito baixo para ${rule.itemName}. O mínimo permitido é ${rule.minAllowedPrice.toLocaleString('pt-BR')} gold por unidade.${reference}`,
    );
  });
}
