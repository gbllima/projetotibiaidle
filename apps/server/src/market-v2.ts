import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { itemsById } from '@tibia-idle/data';
import { acquireItemStacks, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';
import { loadCharacter, type LoadedCharacter } from './game.js';

const MARKET_FEE_PERCENT = 2;
const MARKET_EXPIRES_MS = 72 * 60 * 60 * 1000;
const MARKET_MAX_OFFERS = 12;
const MARKET_MIN_LEVEL = 8;
const MARKET_HISTORY_KEY = 'market:v2:history';
const MARKET_HISTORY_LIMIT = 250;

type MarketRow = Record<string, unknown>;
type TradeHistory = {
  id: string;
  itemId: number;
  itemName: string;
  count: number;
  unitPrice: number;
  total: number;
  buyerId: number;
  buyerName: string;
  sellerId: number;
  sellerName: string;
  at: number;
};

function accountFromRequest(db: Database, request: FastifyRequest): number | null {
  const auth = request.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token ? db.accountIdForToken(token) : null;
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ error });
}

function persist(db: Database, loaded: LoadedCharacter, now = Date.now()): void {
  if (loaded.session) loaded.session.character = loaded.character;
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
}

function addStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (stack) stack.count += count;
  else list.push({ itemId, count });
}

function takeStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): boolean {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || count < 1 || stack.count < count) return false;
  stack.count -= count;
  if (stack.count <= 0) list.splice(list.indexOf(stack), 1);
  return true;
}

function listingId(row: MarketRow): number { return Number(row['id']); }
function sellerId(row: MarketRow): number { return Number(row['seller_id']); }
function itemId(row: MarketRow): number { return Number(row['item_id']); }
function listingCount(row: MarketRow): number { return Math.max(1, Number(row['count']) || 1); }
function listingTotal(row: MarketRow): number { return Math.max(1, Number(row['price']) || 1); }
function listingUnit(row: MarketRow): number { return Math.max(1, Math.ceil(listingTotal(row) / listingCount(row))); }
function createdAt(row: MarketRow): number { return Number(row['created_at']) || 0; }
function sellerName(row: MarketRow): string { return String(row['seller_name'] ?? 'Jogador'); }

function marketCategory(item: Record<string, unknown> | undefined): string {
  if (!item) return 'Loot';
  if (item['slot'] || item['weaponType']) return 'Equipamentos';
  const type = String(item['type'] ?? '').toLowerCase();
  const name = String(item['name'] ?? '').toLowerCase();
  if (/potion|rune|food|fluid|consum/.test(`${type} ${name}`)) return 'Consumíveis';
  return 'Loot';
}

function readHistory(db: Database): TradeHistory[] {
  const raw = db.getWorld(MARKET_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TradeHistory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(db: Database, history: TradeHistory[]): void {
  db.setWorld(MARKET_HISTORY_KEY, JSON.stringify(history.slice(-MARKET_HISTORY_LIMIT)));
}

function creditGold(db: Database, characterId: number, gold: number, now: number): void {
  const row = db.findCharacter(characterId);
  if (!row || gold <= 0) return;
  const state = JSON.parse(row.state) as CharacterState;
  state.gold = (state.gold ?? 0) + gold;
  let sessionJson = row.session;
  if (sessionJson) {
    const session = JSON.parse(sessionJson) as HuntSession;
    session.character.gold = (session.character.gold ?? 0) + gold;
    state.gold = session.character.gold;
    sessionJson = JSON.stringify(session);
  }
  db.saveCharacter(row.id, JSON.stringify(state), sessionJson, now);
}

function returnListingToSeller(db: Database, row: MarketRow, now: number): void {
  const seller = db.findCharacter(sellerId(row));
  if (!seller) {
    db.deleteMarket(listingId(row));
    return;
  }
  const state = JSON.parse(seller.state) as CharacterState;
  state.warehouse ??= [];
  addStack(state.warehouse, itemId(row), listingCount(row));
  let sessionJson = seller.session;
  if (sessionJson) {
    const session = JSON.parse(sessionJson) as HuntSession;
    session.character.warehouse ??= [];
    addStack(session.character.warehouse, itemId(row), listingCount(row));
    state.warehouse = session.character.warehouse;
    sessionJson = JSON.stringify(session);
  }
  db.saveCharacter(seller.id, JSON.stringify(state), sessionJson, now);
  db.deleteMarket(listingId(row));
}

function expireListings(db: Database, now: number): void {
  for (const row of db.listMarket()) {
    if (createdAt(row) > 0 && createdAt(row) + MARKET_EXPIRES_MS <= now) {
      returnListingToSeller(db, row, now);
    }
  }
}

function ownedCharacter(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  characterId: number,
): { accountId: number; loaded: LoadedCharacter } | null {
  const accountId = accountFromRequest(db, request);
  if (accountId === null) {
    fail(reply, 401, 'Faça login novamente.');
    return null;
  }
  const row = db.findCharacter(characterId);
  if (!row) {
    fail(reply, 404, 'Personagem não encontrado.');
    return null;
  }
  if (row.accountId !== accountId) {
    fail(reply, 403, 'Esse personagem não pertence à sua conta.');
    return null;
  }
  return { accountId, loaded: loadCharacter(db, accountId, characterId, Date.now()).loaded };
}

function snapshot(db: Database, loaded: LoadedCharacter, now = Date.now()) {
  expireListings(db, now);
  const rows = db.listMarket().filter((row) => String(row['currency']) === 'gold');
  const own = rows.filter((row) => sellerId(row) === loaded.row.id);
  const external = rows.filter((row) => sellerId(row) !== loaded.row.id);
  const grouped = new Map<number, {
    itemId: number;
    name: string;
    category: string;
    available: number;
    offers: number;
    lowestPrice: number;
  }>();

  for (const row of external) {
    const id = itemId(row);
    const item = itemsById.get(id) as unknown as Record<string, unknown> | undefined;
    const name = String(item?.['name'] ?? `Item ${id}`);
    const unit = listingUnit(row);
    const current = grouped.get(id);
    if (current) {
      current.available += listingCount(row);
      current.offers += 1;
      current.lowestPrice = Math.min(current.lowestPrice, unit);
    } else {
      grouped.set(id, {
        itemId: id,
        name,
        category: marketCategory(item),
        available: listingCount(row),
        offers: 1,
        lowestPrice: unit,
      });
    }
  }

  const offers = external.map((row) => ({
    id: listingId(row),
    sellerId: sellerId(row),
    seller: sellerName(row),
    itemId: itemId(row),
    count: listingCount(row),
    unitPrice: listingUnit(row),
    total: listingUnit(row) * listingCount(row),
    createdAt: createdAt(row),
    expiresAt: createdAt(row) + MARKET_EXPIRES_MS,
  })).sort((a, b) => a.itemId - b.itemId || a.unitPrice - b.unitPrice || a.createdAt - b.createdAt);

  const myOffers = own.map((row) => ({
    id: listingId(row),
    itemId: itemId(row),
    name: String(itemsById.get(itemId(row))?.name ?? `Item ${itemId(row)}`),
    count: listingCount(row),
    unitPrice: listingUnit(row),
    total: listingUnit(row) * listingCount(row),
    createdAt: createdAt(row),
    expiresAt: createdAt(row) + MARKET_EXPIRES_MS,
  })).sort((a, b) => b.createdAt - a.createdAt);

  const inventory = (loaded.character.warehouse ?? []).map((stack) => {
    const item = itemsById.get(stack.itemId) as unknown as Record<string, unknown> | undefined;
    return {
      itemId: stack.itemId,
      name: String(item?.['name'] ?? `Item ${stack.itemId}`),
      count: stack.count,
      category: marketCategory(item),
      npcPrice: Number(item?.['sellPrice'] ?? 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const history = readHistory(db)
    .filter((entry) => entry.buyerId === loaded.row.id || entry.sellerId === loaded.row.id)
    .slice(-40)
    .reverse();

  const priceHistory = new Map<number, { total: number; count: number; last: number }>();
  for (const entry of readHistory(db).slice(-150)) {
    const value = priceHistory.get(entry.itemId) ?? { total: 0, count: 0, last: 0 };
    value.total += entry.unitPrice * entry.count;
    value.count += entry.count;
    value.last = Math.max(value.last, entry.at);
    priceHistory.set(entry.itemId, value);
  }

  return {
    rules: {
      feePercent: MARKET_FEE_PERCENT,
      expiresHours: MARKET_EXPIRES_MS / 3_600_000,
      maxOffers: MARKET_MAX_OFFERS,
      minLevel: MARKET_MIN_LEVEL,
      currency: 'gold',
    },
    character: {
      id: loaded.row.id,
      name: loaded.character.name,
      level: loaded.character.level,
      gold: loaded.character.gold,
    },
    items: [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)),
    offers,
    myOffers,
    inventory,
    history,
    averages: [...priceHistory.entries()].map(([id, value]) => ({
      itemId: id,
      averagePrice: value.count > 0 ? Math.round(value.total / value.count) : 0,
      lastTradeAt: value.last,
    })),
  };
}

export function registerMarketV2Routes(app: FastifyInstance, db: Database): void {
  app.get('/api/market-v2/:characterId', async (request, reply) => {
    const characterId = Number((request.params as { characterId?: string }).characterId);
    const own = ownedCharacter(db, request, reply, characterId);
    if (!own) return;
    return snapshot(db, own.loaded);
  });

  app.post('/api/market-v2/:characterId/list', async (request, reply) => {
    const characterId = Number((request.params as { characterId?: string }).characterId);
    const own = ownedCharacter(db, request, reply, characterId);
    if (!own) return;
    const loaded = own.loaded;
    const now = Date.now();
    expireListings(db, now);
    if (loaded.character.level < MARKET_MIN_LEVEL) return fail(reply, 403, `Mercado liberado no level ${MARKET_MIN_LEVEL}.`);
    if (loaded.session) return fail(reply, 409, 'Saia da hunt antes de anunciar itens.');

    const body = (request.body ?? {}) as Record<string, unknown>;
    const id = Number(body['itemId']);
    const count = Math.floor(Number(body['count']));
    const unitPrice = Math.floor(Number(body['unitPrice']));
    const item = itemsById.get(id);
    if (!item) return fail(reply, 400, 'Item inválido.');
    if (!Number.isInteger(count) || count < 1 || count > 10_000) return fail(reply, 400, 'Quantidade inválida.');
    if (!Number.isInteger(unitPrice) || unitPrice < 1 || unitPrice > 1_000_000_000) return fail(reply, 400, 'Preço inválido.');
    const active = db.listMarket().filter((row) => sellerId(row) === loaded.row.id && String(row['currency']) === 'gold').length;
    if (active >= MARKET_MAX_OFFERS) return fail(reply, 409, `Você já possui ${MARKET_MAX_OFFERS} ofertas ativas.`);
    loaded.character.warehouse ??= [];
    if (!takeStack(loaded.character.warehouse, id, count)) return fail(reply, 400, 'Quantidade não disponível no Depot.');

    const total = unitPrice * count;
    if (!Number.isSafeInteger(total)) return fail(reply, 400, 'Valor total muito alto.');
    const listing = db.transaction(() => {
      persist(db, loaded, now);
      return db.insertMarket({ sellerId: loaded.row.id, sellerName: loaded.character.name, itemId: id, count, price: total, currency: 'gold' });
    });
    db.insertChat('market', loaded.character.name, `Anunciou ${item.name} x${count} por ${unitPrice.toLocaleString('pt-BR')} gold cada.`);
    return { ok: true, listingId: listing, snapshot: snapshot(db, loaded, now) };
  });

  app.post('/api/market-v2/:characterId/cancel', async (request, reply) => {
    const characterId = Number((request.params as { characterId?: string }).characterId);
    const own = ownedCharacter(db, request, reply, characterId);
    if (!own) return;
    const now = Date.now();
    expireListings(db, now);
    const id = Number(((request.body ?? {}) as Record<string, unknown>)['listingId']);
    const row = db.findMarket(id);
    if (!row) return fail(reply, 404, 'Oferta não encontrada.');
    if (sellerId(row) !== own.loaded.row.id) return fail(reply, 403, 'Essa oferta não é sua.');
    db.transaction(() => returnListingToSeller(db, row, now));
    const refreshed = loadCharacter(db, own.accountId, characterId, now).loaded;
    return { ok: true, snapshot: snapshot(db, refreshed, now) };
  });

  app.post('/api/market-v2/:characterId/buy', async (request, reply) => {
    const characterId = Number((request.params as { characterId?: string }).characterId);
    const own = ownedCharacter(db, request, reply, characterId);
    if (!own) return;
    const loaded = own.loaded;
    const now = Date.now();
    expireListings(db, now);
    if (loaded.character.level < MARKET_MIN_LEVEL) return fail(reply, 403, `Mercado liberado no level ${MARKET_MIN_LEVEL}.`);

    const body = (request.body ?? {}) as Record<string, unknown>;
    const id = Number(body['itemId']);
    const count = Math.floor(Number(body['count']));
    const item = itemsById.get(id);
    if (!item) return fail(reply, 400, 'Item inválido.');
    if (!Number.isInteger(count) || count < 1 || count > 10_000) return fail(reply, 400, 'Quantidade inválida.');

    const candidates = db.listMarket()
      .filter((row) => String(row['currency']) === 'gold' && itemId(row) === id && sellerId(row) !== loaded.row.id)
      .sort((a, b) => listingUnit(a) - listingUnit(b) || createdAt(a) - createdAt(b));

    let remaining = count;
    const plan: Array<{ row: MarketRow; take: number; unit: number }> = [];
    let total = 0;
    for (const row of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, listingCount(row));
      const unit = listingUnit(row);
      plan.push({ row, take, unit });
      total += take * unit;
      remaining -= take;
    }
    if (remaining > 0) return fail(reply, 409, 'Não há quantidade suficiente desse item no mercado.');
    if (loaded.character.gold < total) return fail(reply, 402, `Você precisa de ${total.toLocaleString('pt-BR')} gold.`);

    const history = readHistory(db);
    const result = db.transaction(() => {
      const received = acquireItemStacks(loaded.character, id, count);
      if (!received.ok) throw new Error(received.reason);
      loaded.character.gold -= total;
      if (loaded.session) loaded.session.character.gold = loaded.character.gold;

      for (const entry of plan) {
        const row = entry.row;
        const soldTotal = entry.take * entry.unit;
        const payout = Math.floor(soldTotal * (1 - MARKET_FEE_PERCENT / 100));
        creditGold(db, sellerId(row), payout, now);
        db.deleteMarket(listingId(row));
        const left = listingCount(row) - entry.take;
        if (left > 0) {
          db.insertMarket({
            sellerId: sellerId(row),
            sellerName: sellerName(row),
            itemId: id,
            count: left,
            price: entry.unit * left,
            currency: 'gold',
          });
        }
        history.push({
          id: `${now}-${listingId(row)}-${history.length}`,
          itemId: id,
          itemName: item.name,
          count: entry.take,
          unitPrice: entry.unit,
          total: soldTotal,
          buyerId: loaded.row.id,
          buyerName: loaded.character.name,
          sellerId: sellerId(row),
          sellerName: sellerName(row),
          at: now,
        });
      }
      persist(db, loaded, now);
      writeHistory(db, history);
      return received;
    });

    db.insertChat('market', loaded.character.name, `Comprou ${item.name} x${count} por ${total.toLocaleString('pt-BR')} gold.`);
    return { ok: true, count, spent: total, received: result, snapshot: snapshot(db, loaded, now) };
  });
}
