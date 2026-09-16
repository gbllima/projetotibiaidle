import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { itemsById } from '@tibia-idle/data';
import type { Database } from './db.js';
import { requireAdmin } from './admin.js';
import { containsRestrictedChatLink } from './chat-link-protection.js';
import { containsRestrictedChatProfanity } from './chat-profanity-protection.js';

const AUDIT_KEY = 'admin:audit:v1';
const MARKET_HISTORY_KEY = 'market:v2:history';
const AUDIT_LIMIT = 10_000;
const CHAT_CHANNELS = ['geral', 'help', 'market', 'guild', 'comunicados'] as const;
const HIGH_VALUE_GOLD = 100_000_000;
const HIGH_VALUE_COINS = 5_000;

type AuditCategory = 'market' | 'security' | 'economy' | 'admin';

type AuditEntry = {
  id: string;
  category: AuditCategory;
  action: string;
  accountId?: number;
  username?: string;
  characterId?: number;
  actor?: string;
  summary: string;
  details?: Record<string, unknown>;
  suspicious: boolean;
  reason?: string;
  createdAt: number;
};

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

function readJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function readAudit(db: Database): AuditEntry[] {
  return readJsonArray<AuditEntry>(db.getWorld(AUDIT_KEY))
    .filter((entry) => Boolean(entry && typeof entry.id === 'string' && typeof entry.createdAt === 'number'));
}

function readMarketHistory(db: Database): TradeHistory[] {
  return readJsonArray<TradeHistory>(db.getWorld(MARKET_HISTORY_KEY))
    .filter((entry) => Boolean(entry && typeof entry.id === 'string' && typeof entry.at === 'number'));
}

function appendAudit(db: Database, entry: Omit<AuditEntry, 'id'>): void {
  try {
    const audit = readAudit(db);
    const id = `${entry.createdAt}-${entry.category}-${entry.action}-${Math.random().toString(36).slice(2, 8)}`;
    audit.push({ id, ...entry });
    db.setWorld(AUDIT_KEY, JSON.stringify(audit.slice(-AUDIT_LIMIT)));
  } catch {
    // Audit must never break a player action.
  }
}

function actorInfo(db: Database, characterId: number) {
  const row = db.findCharacter(characterId);
  if (!row) return { characterId };
  const account = db.findAccountById(row.accountId);
  return {
    accountId: row.accountId,
    username: account?.username,
    characterId: row.id,
    actor: row.name,
  };
}

function marketAverage(db: Database, itemId: number, now: number): { average: number; samples: number } | null {
  const trades = readMarketHistory(db)
    .filter((entry) => entry.itemId === itemId && entry.at < now - 2_000)
    .slice(-80);
  if (trades.length < 3) return null;
  const units = trades.reduce((sum, entry) => sum + Math.max(1, entry.count), 0);
  if (units <= 0) return null;
  const total = trades.reduce((sum, entry) => sum + entry.unitPrice * Math.max(1, entry.count), 0);
  return { average: Math.max(1, Math.round(total / units)), samples: trades.length };
}

function marketSuspicion(db: Database, characterId: number, itemId: number, unitPrice: number, total: number, now: number): string[] {
  const reasons: string[] = [];
  if (total >= HIGH_VALUE_GOLD) reasons.push(`valor elevado (${total.toLocaleString('pt-BR')} gold)`);
  const benchmark = marketAverage(db, itemId, now);
  if (benchmark && unitPrice > 0) {
    if (unitPrice >= benchmark.average * 5) reasons.push(`preço unitário muito acima da média recente (${benchmark.average.toLocaleString('pt-BR')})`);
    else if (unitPrice * 5 <= benchmark.average) reasons.push(`preço unitário muito abaixo da média recente (${benchmark.average.toLocaleString('pt-BR')})`);
  }
  const recent = readAudit(db).filter((entry) =>
    entry.category === 'market'
    && entry.characterId === characterId
    && entry.createdAt >= now - 5 * 60_000,
  ).length;
  if (recent >= 12) reasons.push('muitas ações de mercado em menos de 5 minutos');
  return reasons;
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

function chatSnapshot(db: Database, limit: number) {
  const perChannel = Math.min(20_000, Math.max(100, limit * 3));
  const all = CHAT_CHANNELS.flatMap((channel) => db.listChat(channel, perChannel).map((row) => {
    const author = String(row['author'] ?? '');
    const character = db.findCharacterByName(author);
    const account = character ? db.findAccountById(character.accountId) : null;
    return {
      id: `chat-${Number(row['id'])}`,
      kind: 'chat' as const,
      action: 'message',
      channel,
      accountId: character?.accountId,
      username: account?.username,
      characterId: character?.id,
      actor: author,
      summary: String(row['body'] ?? ''),
      suspicious: false,
      createdAt: Number(row['created_at']) || 0,
    };
  }));
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function marketSnapshot(db: Database, limit: number) {
  const history = readMarketHistory(db);
  const audit = readAudit(db);
  const historyIds = new Set(history.map((entry) => entry.id));

  const trades = history.map((entry) => ({
    id: `trade-${entry.id}`,
    kind: 'market' as const,
    action: 'trade',
    actor: entry.buyerName,
    characterId: entry.buyerId,
    summary: `${entry.buyerName} comprou ${entry.itemName} x${entry.count} de ${entry.sellerName} por ${entry.total.toLocaleString('pt-BR')} gold`,
    details: {
      itemId: entry.itemId,
      itemName: entry.itemName,
      count: entry.count,
      unitPrice: entry.unitPrice,
      total: entry.total,
      buyerId: entry.buyerId,
      buyerName: entry.buyerName,
      sellerId: entry.sellerId,
      sellerName: entry.sellerName,
    },
    suspicious: false,
    createdAt: entry.at,
  }));

  const archived = audit
    .filter((entry) => entry.category === 'market')
    .filter((entry) => {
      const tradeIds = Array.isArray(entry.details?.['tradeIds']) ? entry.details?.['tradeIds'] as string[] : [];
      return tradeIds.length === 0 || !tradeIds.some((id) => historyIds.has(id));
    })
    .map((entry) => ({ ...entry, kind: 'market' as const }));

  return [...trades, ...archived].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function auditSnapshot(db: Database, limit: number) {
  return readAudit(db).slice(-limit).reverse().map((entry) => ({ ...entry, kind: entry.category }));
}

function suspiciousSnapshot(db: Database, limit: number) {
  return readAudit(db).filter((entry) => entry.suspicious).slice(-limit).reverse().map((entry) => ({ ...entry, kind: entry.category }));
}

function registerRequestAuditHook(app: FastifyInstance, db: Database): void {
  app.addHook('onResponse', async (request, reply) => {
    const now = Date.now();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const url = request.url.split('?')[0] ?? request.url;

    const actMatch = url.match(/^\/api\/characters\/(\d+)\/act$/);
    if (actMatch) {
      const characterId = Number(actMatch[1]);
      const type = String(body['type'] ?? '');
      const actor = actorInfo(db, characterId);

      if (type === 'chat' && reply.statusCode === 422) {
        const text = String(body['body'] ?? '');
        const link = containsRestrictedChatLink(text);
        const profanity = containsRestrictedChatProfanity(text);
        if (link || profanity) {
          appendAudit(db, {
            category: 'security',
            action: link ? 'chat_link_blocked' : 'chat_profanity_blocked',
            ...actor,
            summary: `${actor.actor ?? `Personagem #${characterId}`} tentou enviar conteúdo bloqueado no chat.`,
            details: { channel: String(body['channel'] ?? 'geral'), message: text.slice(0, 200) },
            suspicious: true,
            reason: link ? 'tentativa de envio de link bloqueado' : 'tentativa de envio de palavra de baixo calão bloqueada',
            createdAt: now,
          });
        }
        return;
      }

      if (reply.statusCode < 200 || reply.statusCode >= 300) return;
      if (type === 'market-list') {
        const itemId = Number(body['itemId']);
        const count = Math.max(1, Number(body['count']) || 1);
        const total = Math.max(0, Number(body['price']) || 0);
        const unit = Math.max(1, Math.round(total / count));
        const reasons = marketSuspicion(db, characterId, itemId, unit, total, now);
        appendAudit(db, {
          category: 'market', action: 'legacy_list', ...actor,
          summary: `${actor.actor ?? 'Jogador'} anunciou ${itemsById.get(itemId)?.name ?? `item ${itemId}`} x${count} por ${total.toLocaleString('pt-BR')} ${String(body['currency'] ?? 'gold')}.`,
          details: { itemId, count, total, currency: String(body['currency'] ?? 'gold') },
          suspicious: reasons.length > 0, reason: reasons.join('; ') || undefined, createdAt: now,
        });
      } else if (type === 'market-buy') {
        appendAudit(db, {
          category: 'market', action: 'legacy_buy', ...actor,
          summary: `${actor.actor ?? 'Jogador'} realizou uma compra no mercado legado.`,
          details: { listingId: Number(body['listingId']) }, suspicious: false, createdAt: now,
        });
      } else if (type === 'transfer') {
        const coins = Math.max(0, Number(body['coins']) || 0);
        const suspicious = coins >= HIGH_VALUE_COINS;
        appendAudit(db, {
          category: 'economy', action: 'coin_transfer', ...actor,
          summary: `${actor.actor ?? 'Jogador'} transferiu ${coins.toLocaleString('pt-BR')} coins para ${String(body['name'] ?? 'outro personagem')}.`,
          details: { coins, target: String(body['name'] ?? '') }, suspicious,
          reason: suspicious ? `transferência elevada de coins (>= ${HIGH_VALUE_COINS.toLocaleString('pt-BR')})` : undefined,
          createdAt: now,
        });
      }
      return;
    }

    const marketMatch = url.match(/^\/api\/market-v2\/(\d+)\/(list|buy|cancel)$/);
    if (marketMatch && request.method === 'POST' && reply.statusCode >= 200 && reply.statusCode < 300) {
      const characterId = Number(marketMatch[1]);
      const action = marketMatch[2]!;
      const actor = actorInfo(db, characterId);
      const itemId = Number(body['itemId']);
      const count = Math.max(1, Number(body['count']) || 1);
      let reasons: string[] = [];
      let details: Record<string, unknown> = { itemId, count };
      let summary = `${actor.actor ?? 'Jogador'} realizou uma ação no mercado.`;

      if (action === 'list') {
        const unitPrice = Math.max(1, Number(body['unitPrice']) || 1);
        const total = unitPrice * count;
        reasons = marketSuspicion(db, characterId, itemId, unitPrice, total, now);
        details = { itemId, itemName: itemsById.get(itemId)?.name, count, unitPrice, total };
        summary = `${actor.actor ?? 'Jogador'} anunciou ${itemsById.get(itemId)?.name ?? `item ${itemId}`} x${count} por ${unitPrice.toLocaleString('pt-BR')} gold cada.`;
      } else if (action === 'buy') {
        const recentTrades = readMarketHistory(db).filter((entry) => entry.buyerId === characterId && entry.itemId === itemId && entry.at >= now - 5_000);
        const total = recentTrades.reduce((sum, entry) => sum + entry.total, 0);
        const bought = recentTrades.reduce((sum, entry) => sum + entry.count, 0) || count;
        const unitPrice = bought > 0 ? Math.round(total / bought) : 0;
        reasons = marketSuspicion(db, characterId, itemId, unitPrice, total, now);
        const ownAccountTrade = recentTrades.some((entry) => db.findCharacter(entry.sellerId)?.accountId === actor.accountId);
        if (ownAccountTrade) reasons.push('compra entre personagens da mesma conta');
        details = {
          itemId,
          itemName: itemsById.get(itemId)?.name,
          count: bought,
          total,
          tradeIds: recentTrades.map((entry) => entry.id),
          sellers: [...new Set(recentTrades.map((entry) => entry.sellerName))],
        };
        summary = `${actor.actor ?? 'Jogador'} comprou ${itemsById.get(itemId)?.name ?? `item ${itemId}`} x${bought}${total ? ` por ${total.toLocaleString('pt-BR')} gold` : ''}.`;
      } else {
        details = { listingId: Number(body['listingId']) };
        summary = `${actor.actor ?? 'Jogador'} cancelou uma oferta do mercado.`;
      }

      appendAudit(db, {
        category: 'market', action: `market_v2_${action}`, ...actor, summary, details,
        suspicious: reasons.length > 0, reason: reasons.join('; ') || undefined, createdAt: now,
      });
      return;
    }

    if (url === '/api/login' && reply.statusCode === 429) {
      appendAudit(db, {
        category: 'security', action: 'login_rate_limit',
        summary: `Muitas tentativas de login para o usuário ${String(body['username'] ?? 'desconhecido')}.`,
        details: { username: String(body['username'] ?? '') }, suspicious: true,
        reason: 'limite de tentativas de autenticação atingido', createdAt: now,
      });
    }
  });
}

export function registerAdminLogs(app: FastifyInstance, db: Database): void {
  registerRequestAuditHook(app, db);

  app.get('/api/admin/logs', async (request, reply) => {
    const accountId = accountFromRequest(db, request);
    if (accountId === null) return fail(reply, 401, 'Sign in first.');
    try {
      requireAdmin(db, accountId);
    } catch {
      return fail(reply, 403, 'Admin only.');
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = numberFromQuery(query['limit'], 300, 50, 5_000);
    const chat = chatSnapshot(db, limit);
    const market = marketSnapshot(db, limit);
    const audit = auditSnapshot(db, limit);
    const suspicious = suspiciousSnapshot(db, limit);

    return {
      generatedAt: Date.now(),
      limit,
      chat,
      market,
      audit,
      suspicious,
      counts: {
        chat: chat.length,
        market: market.length,
        audit: readAudit(db).length,
        suspicious: readAudit(db).filter((entry) => entry.suspicious).length,
      },
      retention: {
        chat: 'SQLite: mensagens persistidas nos canais do jogo',
        audit: AUDIT_LIMIT,
        marketLegacyHistory: 'histórico existente + auditoria contínua a partir desta atualização',
      },
    };
  });
}
