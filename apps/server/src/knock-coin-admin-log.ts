import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COIN_PACKS, SHOP, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import type { Database } from './db.js';
import { requireAdmin } from './admin.js';

const SPEND_LOG_KEY = 'admin:knock-coins:spend:v1';
const SPEND_LOG_LIMIT = 10_000;

type CoinSpendEntry = {
  id: string;
  accountId: number;
  username?: string;
  characterId: number;
  actor: string;
  action: string;
  label: string;
  kind?: string;
  sku?: string;
  coins: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: number;
};

type CoinSnapshot = {
  characterId: number;
  action: string;
  sku?: string;
  balanceBefore: number;
};

function readJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function readSpendLog(db: Database): CoinSpendEntry[] {
  return readJsonArray<CoinSpendEntry>(db.getWorld(SPEND_LOG_KEY))
    .filter((entry) => Boolean(
      entry
      && typeof entry.id === 'string'
      && Number.isFinite(entry.coins)
      && typeof entry.createdAt === 'number',
    ));
}

function appendSpend(db: Database, entry: Omit<CoinSpendEntry, 'id'>): void {
  try {
    const entries = readSpendLog(db);
    const id = `${entry.createdAt}-${entry.characterId}-${Math.random().toString(36).slice(2, 8)}`;
    entries.push({ id, ...entry });
    db.setWorld(SPEND_LOG_KEY, JSON.stringify(entries.slice(-SPEND_LOG_LIMIT)));
  } catch {
    // Finance logging must never break a player action.
  }
}

function accountFromRequest(db: Database, request: FastifyRequest): number | null {
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return db.accountIdForToken(header.slice(7).trim());
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ error });
}

function numberFromQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function authoritativeCharacter(db: Database, characterId: number): CharacterState | null {
  const row = db.findCharacter(characterId);
  if (!row) return null;
  try {
    if (row.session) {
      const session = JSON.parse(row.session) as HuntSession;
      if (session.character) return session.character;
    }
    return JSON.parse(row.state) as CharacterState;
  } catch {
    return null;
  }
}

function spendMetadata(action: string, sku?: string): { label: string; kind?: string; sku?: string } {
  if (action === 'shop') {
    const offer = SHOP.find((entry) => entry.id === sku);
    if (offer) return { label: offer.name, kind: offer.kind, sku: offer.id };
    return { label: sku ? `Loja: ${sku}` : 'Compra na loja', kind: 'shop', sku };
  }
  if (action === 'loot-slot') return { label: 'Expansão da Loot Pouch', kind: 'pouch' };
  if (action === 'supply-slot') return { label: 'Expansão da Supply Pouch', kind: 'pouch' };
  if (action === 'party-unlock') return { label: 'Slot de Party', kind: 'party' };
  if (action === 'roleta-spin') return { label: 'Roleta', kind: 'roulette' };
  return { label: action, kind: 'resource' };
}

function purchaseSnapshot(db: Database, limit: number) {
  return db.listCoinOrders()
    .map((order) => {
      const accountId = Number(order['account_id']);
      const account = db.findAccountById(accountId);
      const firstCharacter = db.charactersForAccount(accountId)[0];
      const packId = String(order['pack_id']);
      const pack = COIN_PACKS.find((entry) => entry.id === packId);
      return {
        id: `order-${Number(order['id'])}`,
        orderId: Number(order['id']),
        accountId,
        username: account?.username ?? `Conta #${accountId}`,
        characterId: firstCharacter?.id,
        actor: firstCharacter?.name,
        packId,
        packName: pack?.name ?? packId,
        coins: Number(order['coins']) || 0,
        brl: Number(order['brl']) || 0,
        status: String(order['status'] ?? 'pending'),
        createdAt: Number(order['created_at']) || 0,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function registerKnockCoinAdminLog(app: FastifyInstance, db: Database): void {
  const snapshots = new Map<string, CoinSnapshot>();

  app.addHook('preHandler', async (request) => {
    const url = request.url.split('?')[0] ?? request.url;
    const match = url.match(/^\/api\/characters\/(\d+)\/act$/);
    if (!match) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const action = String(body['type'] ?? '');
    // Transfers only move KC between characters and are not consumption.
    if (!action || action === 'transfer') return;
    const characterId = Number(match[1]);
    const character = authoritativeCharacter(db, characterId);
    if (!character) return;
    snapshots.set(request.id, {
      characterId,
      action,
      sku: action === 'shop' ? String(body['sku'] ?? '') : undefined,
      balanceBefore: Math.max(0, Number(character.coins) || 0),
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const snapshot = snapshots.get(request.id);
    snapshots.delete(request.id);
    if (!snapshot || reply.statusCode < 200 || reply.statusCode >= 300) return;

    const character = authoritativeCharacter(db, snapshot.characterId);
    if (!character) return;
    const balanceAfter = Math.max(0, Number(character.coins) || 0);
    const coins = snapshot.balanceBefore - balanceAfter;
    if (coins <= 0) return;

    const row = db.findCharacter(snapshot.characterId);
    if (!row) return;
    const account = db.findAccountById(row.accountId);
    const metadata = spendMetadata(snapshot.action, snapshot.sku);
    appendSpend(db, {
      accountId: row.accountId,
      username: account?.username,
      characterId: row.id,
      actor: row.name,
      action: snapshot.action,
      label: metadata.label,
      kind: metadata.kind,
      sku: metadata.sku,
      coins,
      balanceBefore: snapshot.balanceBefore,
      balanceAfter,
      createdAt: Date.now(),
    });
  });

  app.get('/api/admin/knock-coins/logs', async (request, reply) => {
    const accountId = accountFromRequest(db, request);
    if (accountId === null) return fail(reply, 401, 'Sign in first.');
    try {
      requireAdmin(db, accountId);
    } catch {
      return fail(reply, 403, 'Admin only.');
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = numberFromQuery(query['limit'], 300, 50, 5_000);
    const purchases = purchaseSnapshot(db, limit);
    const spends = readSpendLog(db).slice(-limit).reverse();
    const paid = purchases.filter((entry) => entry.status === 'paid');

    return {
      generatedAt: Date.now(),
      limit,
      purchases,
      spends,
      totals: {
        orders: purchases.length,
        paidOrders: paid.length,
        pendingOrders: purchases.filter((entry) => entry.status === 'pending').length,
        purchasedCoins: paid.reduce((sum, entry) => sum + entry.coins, 0),
        paidBrl: paid.reduce((sum, entry) => sum + entry.brl, 0),
        spendEvents: spends.length,
        spentCoins: spends.reduce((sum, entry) => sum + entry.coins, 0),
      },
      retention: { spends: SPEND_LOG_LIMIT, purchases: 'coin_orders (SQLite)' },
    };
  });
}
