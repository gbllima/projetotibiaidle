import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COIN_PACKS, SHOP, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import type { Database } from './db.js';
import { requireAdmin } from './admin.js';

const COIN_AUDIT_KEY = 'admin:knock-coins:audit:v1';
const COIN_AUDIT_LIMIT = 10_000;

type CoinAuditAction = 'shop_spend' | 'purchase_paid' | 'redeem_credit' | 'admin_grant';

type CoinAuditEntry = {
  id: string;
  action: CoinAuditAction;
  accountId: number;
  username?: string;
  characterId?: number;
  actor?: string;
  summary: string;
  coins: number;
  direction: 'credit' | 'debit';
  balance?: number;
  details?: Record<string, unknown>;
  createdAt: number;
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

function readCoinAudit(db: Database): CoinAuditEntry[] {
  return readJsonArray<CoinAuditEntry>(db.getWorld(COIN_AUDIT_KEY))
    .filter((entry) => Boolean(entry && typeof entry.id === 'string' && typeof entry.createdAt === 'number'));
}

function appendCoinAudit(db: Database, entry: Omit<CoinAuditEntry, 'id'>): void {
  try {
    const audit = readCoinAudit(db);
    const id = `${entry.createdAt}-${entry.action}-${Math.random().toString(36).slice(2, 8)}`;
    audit.push({ id, ...entry });
    db.setWorld(COIN_AUDIT_KEY, JSON.stringify(audit.slice(-COIN_AUDIT_LIMIT)));
  } catch {
    // Financial auditing must never break the player action that already succeeded.
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

function actorInfo(db: Database, characterId: number) {
  const row = db.findCharacter(characterId);
  if (!row) return null;
  const account = db.findAccountById(row.accountId);
  return {
    accountId: row.accountId,
    username: account?.username,
    characterId: row.id,
    actor: row.name,
  };
}

function currentCoins(db: Database, characterId: number): number | undefined {
  const row = db.findCharacter(characterId);
  if (!row) return undefined;
  try {
    const character = row.session
      ? (JSON.parse(row.session) as HuntSession).character
      : JSON.parse(row.state) as CharacterState;
    return Math.max(0, Number(character.coins) || 0);
  } catch {
    return undefined;
  }
}

function accountRecipient(db: Database, accountId: number) {
  const account = db.findAccountById(accountId);
  const row = db.charactersForAccount(accountId)[0];
  return {
    accountId,
    username: account?.username,
    characterId: row?.id,
    actor: row?.name,
  };
}

function orderSnapshot(db: Database) {
  return db.listCoinOrders().map((row) => {
    const accountId = Number(row['account_id']);
    const account = db.findAccountById(accountId);
    return {
      id: Number(row['id']),
      accountId,
      username: account?.username ?? `Conta #${accountId}`,
      packId: String(row['pack_id']),
      coins: Math.max(0, Number(row['coins']) || 0),
      brl: Math.max(0, Number(row['brl']) || 0),
      status: String(row['status']),
      createdAt: Number(row['created_at']) || 0,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

function registerCoinAuditHook(app: FastifyInstance, db: Database): void {
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    const now = Date.now();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const url = request.url.split('?')[0] ?? request.url;

    const actMatch = url.match(/^\/api\/characters\/(\d+)\/act$/);
    if (actMatch) {
      const characterId = Number(actMatch[1]);
      const type = String(body['type'] ?? '');
      const actor = actorInfo(db, characterId);
      if (!actor) return;

      if (type === 'shop') {
        const sku = String(body['sku'] ?? '');
        const offer = SHOP.find((entry) => entry.id === sku);
        if (!offer || offer.coins <= 0) return;
        appendCoinAudit(db, {
          action: 'shop_spend',
          ...actor,
          summary: `${actor.actor} comprou ${offer.name} por ${offer.coins.toLocaleString('pt-BR')} KC.`,
          coins: offer.coins,
          direction: 'debit',
          balance: currentCoins(db, characterId),
          details: {
            sku: offer.id,
            product: offer.name,
            kind: offer.kind,
            category: offer.category,
          },
          createdAt: now,
        });
        return;
      }

      if (type === 'redeem') {
        const code = String(body['code'] ?? '').trim().toUpperCase();
        const redeemed = db.findRedeemCode(code);
        const coins = Math.max(0, Number(redeemed?.['coins']) || 0);
        if (coins <= 0) return;
        appendCoinAudit(db, {
          action: 'redeem_credit',
          ...actor,
          summary: `${actor.actor} recebeu ${coins.toLocaleString('pt-BR')} KC por código de resgate.`,
          coins,
          direction: 'credit',
          balance: currentCoins(db, characterId),
          details: { source: 'redeem_code' },
          createdAt: now,
        });
      }
      return;
    }

    if (url === '/api/admin' && request.method === 'POST') {
      const type = String(body['type'] ?? '');
      const adminAccountId = accountFromRequest(db, request);
      const adminUsername = adminAccountId == null ? undefined : db.findAccountById(adminAccountId)?.username;

      if (type === 'fulfill') {
        const orderId = Number(body['orderId']);
        const order = db.findCoinOrder(orderId);
        if (!order || String(order['status']) !== 'paid') return;
        const owner = Number(order['account_id']);
        const recipient = accountRecipient(db, owner);
        const coins = Math.max(0, Number(order['coins']) || 0);
        appendCoinAudit(db, {
          action: 'purchase_paid',
          ...recipient,
          summary: `${recipient.username ?? `Conta #${owner}`} recebeu ${coins.toLocaleString('pt-BR')} KC da compra #${orderId}.`,
          coins,
          direction: 'credit',
          balance: recipient.characterId ? currentCoins(db, recipient.characterId) : undefined,
          details: {
            orderId,
            packId: String(order['pack_id']),
            brl: Number(order['brl']) || 0,
            confirmedBy: adminUsername,
          },
          createdAt: now,
        });
        return;
      }

      if (type === 'grant') {
        const coins = Math.max(0, Number(body['coins']) || 0);
        const characterId = Number(body['characterId']);
        if (coins <= 0 || !Number.isInteger(characterId)) return;
        const actor = actorInfo(db, characterId);
        if (!actor) return;
        appendCoinAudit(db, {
          action: 'admin_grant',
          ...actor,
          summary: `${actor.actor} recebeu ${coins.toLocaleString('pt-BR')} KC por crédito administrativo.`,
          coins,
          direction: 'credit',
          balance: currentCoins(db, characterId),
          details: { grantedBy: adminUsername },
          createdAt: now,
        });
      }
    }
  });
}

export function registerKnockCoinsLog(app: FastifyInstance, db: Database): void {
  registerCoinAuditHook(app, db);

  app.get('/api/admin/knock-coins-log', async (request, reply) => {
    const accountId = accountFromRequest(db, request);
    if (accountId === null) return fail(reply, 401, 'Sign in first.');
    try {
      requireAdmin(db, accountId);
    } catch {
      return fail(reply, 403, 'Admin only.');
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = numberFromQuery(query['limit'], 500, 50, 5_000);
    const allOrders = orderSnapshot(db);
    const allTransactions = readCoinAudit(db);
    const orders = allOrders.slice(0, limit);
    const transactions = allTransactions.slice(-limit).reverse();
    const paidOrders = allOrders.filter((entry) => entry.status === 'paid');
    const pendingOrders = allOrders.filter((entry) => entry.status === 'pending');
    const spent = allTransactions.filter((entry) => entry.direction === 'debit');

    return {
      generatedAt: Date.now(),
      limit,
      orders,
      transactions,
      counts: {
        orders: allOrders.length,
        paid: paidOrders.length,
        pending: pendingOrders.length,
        transactions: allTransactions.length,
      },
      totals: {
        purchasedCoins: paidOrders.reduce((sum, entry) => sum + entry.coins, 0),
        purchasedBrl: paidOrders.reduce((sum, entry) => sum + entry.brl, 0),
        spentCoins: spent.reduce((sum, entry) => sum + entry.coins, 0),
      },
      retention: COIN_AUDIT_LIMIT,
      packs: COIN_PACKS,
    };
  });
}
