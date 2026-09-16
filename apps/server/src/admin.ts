import { setWorldEvent, type CharacterState, type HuntSession, addItemStack } from '@tibia-idle/sim';
import { itemsById } from '@tibia-idle/data';
import { isAdminUsername } from './auth.js';
import type { Database } from './db.js';
import { createNewCharacter, describeCharacter, loadCharacter, stopHunt } from './game.js';
import { metricsSnapshot } from './metrics.js';
import { grantAccountVipDays } from './economy.js';
import { GameError } from './settle.js';

export { isAdminUsername };

const SITE_NEWS_KEY = 'site-news';

export interface SiteNewsItem {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number;
}

function readSiteNews(db: Database): SiteNewsItem[] {
  const raw = db.getWorld(SITE_NEWS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SiteNewsItem => Boolean(entry && typeof entry === 'object' && typeof (entry as SiteNewsItem).id === 'string'))
      .map((entry) => ({
        id: String(entry.id),
        title: String(entry.title ?? '').slice(0, 120),
        category: String(entry.category ?? 'Novidade').slice(0, 40),
        summary: String(entry.summary ?? '').slice(0, 280),
        body: String(entry.body ?? '').slice(0, 8000),
        published: Boolean(entry.published),
        createdAt: Number(entry.createdAt) || 0,
        updatedAt: Number(entry.updatedAt) || Number(entry.createdAt) || 0,
        publishedAt: Number(entry.publishedAt) || Number(entry.createdAt) || 0,
      }));
  } catch {
    return [];
  }
}

function saveSiteNews(db: Database, news: SiteNewsItem[]): void {
  db.setWorld(SITE_NEWS_KEY, JSON.stringify(news));
}

export function siteNewsSnapshot(db: Database, publicOnly = false): SiteNewsItem[] {
  return readSiteNews(db)
    .filter((entry) => !publicOnly || entry.published)
    .sort((a, b) => (b.publishedAt || b.updatedAt) - (a.publishedAt || a.updatedAt));
}

export function requireAdmin(db: Database, accountId: number): void {
  const account = db.findAccountById(accountId);
  if (!account || !isAdminUsername(account.username)) {
    throw new GameError('Admin only.', 403);
  }
}

export function loadWorldEvent(db: Database): void {
  const raw = db.getWorld('event');
  if (!raw) {
    setWorldEvent(null);
    return;
  }
  try {
    const parsed = JSON.parse(raw) as { name?: string; experience?: number; loot?: number };
    setWorldEvent({
      name: String(parsed.name ?? ''),
      experience: Number(parsed.experience) || 1,
      loot: Number(parsed.loot) || 1,
    });
  } catch {
    setWorldEvent(null);
  }
}

export function adminSnapshot(db: Database) {
  const accounts = db.listAccounts().map((account) => ({
    id: account.id,
    username: account.username,
    admin: isAdminUsername(account.username),
    banned: Boolean(db.getWorld('ban:' + account.id)),
    characters: db.charactersForAccount(account.id).map((row) => {
      const state = row.session ? (JSON.parse(row.session) as HuntSession).character : JSON.parse(row.state) as CharacterState;
      return { id: row.id, name: state.name, level: state.level, gold: state.gold, coins: state.coins };
    }),
  }));
  const orders = db.listCoinOrders().map((order) => ({
    id: Number(order['id']),
    accountId: Number(order['account_id']),
    packId: String(order['pack_id']),
    coins: Number(order['coins']),
    brl: Number(order['brl']),
    status: String(order['status']),
    createdAt: Number(order['created_at']),
  }));
  return {
    accounts,
    orders,
    event: JSON.parse(db.getWorld('event') ?? '{"name":"","experience":1,"loot":1}'),
    metrics: metricsSnapshot(db),
    invites: db.listInvites().map((row) => ({
      code: String(row['code']),
      usedBy: row['used_by'] ? Number(row['used_by']) : null,
    })),
    news: siteNewsSnapshot(db),
  };
}

export function adminAct(
  db: Database,
  accountId: number,
  body: Record<string, unknown>,
  now = Date.now(),
): Record<string, unknown> {
  requireAdmin(db, accountId);
  const type = String(body.type ?? '');

  const integer = (value: unknown, max = 1_000_000_000): number => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new GameError('Valor numérico inválido.', 422);
    return n;
  };

  const stopAdministrativeHunt = (targetAccountId: number, characterId: number): void => {
    if (!db.findCharacter(characterId)) return;
    if (!db.queuedHunt(characterId) && !db.findCharacter(characterId)?.session) return;
    try {
      stopHunt(db, targetAccountId, characterId, now);
    } catch (error) {
      if (!(error instanceof GameError) || error.status !== 409) throw error;
    }
  };

  if (type === 'news-create' || type === 'news-update') {
    const title = String(body.title ?? '').trim();
    const category = String(body.category ?? 'Novidade').trim() || 'Novidade';
    const summary = String(body.summary ?? '').trim();
    const content = String(body.body ?? '').trim();
    const published = body.published === undefined ? true : Boolean(body.published);
    const requestedPublishedAt = body.publishedAt === undefined ? undefined : Number(body.publishedAt);
    if (title.length < 3 || title.length > 120) throw new GameError('O título deve ter entre 3 e 120 caracteres.', 422);
    if (category.length > 40) throw new GameError('A categoria pode ter no máximo 40 caracteres.', 422);
    if (summary.length < 5 || summary.length > 280) throw new GameError('O resumo deve ter entre 5 e 280 caracteres.', 422);
    if (content.length < 5 || content.length > 8000) throw new GameError('O texto da notícia deve ter entre 5 e 8000 caracteres.', 422);
    if (requestedPublishedAt !== undefined && (!Number.isSafeInteger(requestedPublishedAt) || requestedPublishedAt <= 0)) {
      throw new GameError('Data de publicação inválida.', 422);
    }

    const news = readSiteNews(db);
    if (type === 'news-create') {
      const item: SiteNewsItem = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        category,
        summary,
        body: content,
        published,
        createdAt: now,
        updatedAt: now,
        publishedAt: requestedPublishedAt ?? now,
      };
      news.unshift(item);
      saveSiteNews(db, news.slice(0, 100));
      db.setWorld('admin-audit:' + now + ':news:' + item.id, JSON.stringify({ type, by: accountId, id: item.id }));
      return { news: item };
    }

    const id = String(body.id ?? '');
    const index = news.findIndex((entry) => entry.id === id);
    if (index < 0) throw new GameError('Notícia não encontrada.', 404);
    const previous = news[index]!;
    const item: SiteNewsItem = {
      ...previous,
      title,
      category,
      summary,
      body: content,
      published,
      updatedAt: now,
      publishedAt: requestedPublishedAt ?? (published && !previous.published ? now : previous.publishedAt),
    };
    news[index] = item;
    saveSiteNews(db, news);
    db.setWorld('admin-audit:' + now + ':news:' + item.id, JSON.stringify({ type, by: accountId, id: item.id }));
    return { news: item };
  }

  if (type === 'news-delete') {
    const id = String(body.id ?? '');
    const news = readSiteNews(db);
    if (!news.some((entry) => entry.id === id)) throw new GameError('Notícia não encontrada.', 404);
    saveSiteNews(db, news.filter((entry) => entry.id !== id));
    db.setWorld('admin-audit:' + now + ':news:' + id, JSON.stringify({ type, by: accountId, id }));
    return { ok: true };
  }

  if (type === 'ban' || type === 'unban') {
    const targetId = integer(body.accountId);
    const target = db.findAccountById(targetId);
    if (!target) throw new GameError('Conta não encontrada.', 404);
    if (type === 'ban' && isAdminUsername(target.username)) throw new GameError('Não é possível banir um administrador.', 403);
    if (type === 'ban') {
      for (const row of db.charactersForAccount(targetId)) stopAdministrativeHunt(targetId, row.id);
      db.setWorld('ban:' + target.id, JSON.stringify({ reason: String(body.reason ?? 'Banido pelo administrador').slice(0, 500), at: now, by: accountId }));
      db.revokeAccountTokens(targetId);
    } else db.setWorld('ban:' + targetId, '');
    db.setWorld('admin-audit:' + now + ':' + targetId, JSON.stringify({ type, by: accountId, targetId }));
    return { ok: true };
  }

  if (type === 'create-character') {
    const owner = integer(body.accountId);
    if (!db.findAccountById(owner)) throw new GameError('Conta não encontrada.', 404);
    const created = createNewCharacter(db, owner, String(body.name ?? ''), integer(body.vocationId));
    return { character: describeCharacter(created, db) };
  }

  if (type === 'set-gold' || type === 'set-item') {
    const id = integer(body.characterId);
    const row = db.findCharacter(id);
    if (!row) throw new GameError('Personagem não encontrado.', 404);
    const { loaded } = loadCharacter(db, row.accountId, id, now);
    if (type === 'set-gold') loaded.character.gold = integer(body.gold);
    else {
      const itemId = integer(body.itemId);
      const count = integer(body.count, 100_000);
      if (!itemsById.has(itemId)) throw new GameError('Item inválido.', 422);
      loaded.character.warehouse ??= [];
      loaded.character.warehouse = loaded.character.warehouse.filter((stack) => stack.itemId !== itemId);
      if (count > 0) addItemStack(loaded.character.warehouse, itemId, count);
    }
    db.saveCharacter(id, JSON.stringify(loaded.character), loaded.session ? JSON.stringify(loaded.session) : null, now);
    db.setWorld('admin-audit:' + now + ':' + id, JSON.stringify({ type, by: accountId, characterId: id, value: type === 'set-gold' ? loaded.character.gold : { itemId: body.itemId, count: body.count } }));
    return { character: describeCharacter(loaded, db) };
  }

  if (type === 'grant') {
    const characterId = integer(body.characterId);
    const row = db.findCharacter(characterId);
    if (!row) throw new GameError('No such character.', 404);
    const { loaded } = loadCharacter(db, row.accountId, characterId, now);
    const gold = integer(body.gold ?? 0);
    const coins = integer(body.coins ?? 0);
    const vipDays = integer(body.vipDays ?? 0, 3650);
    loaded.character.gold += gold;
    loaded.character.coins += coins;
    db.saveCharacter(loaded.row.id, JSON.stringify(loaded.character), loaded.session ? JSON.stringify(loaded.session) : null, now);
    if (vipDays > 0) {
      grantAccountVipDays(db, row.accountId, vipDays, now);
      const refreshed = loadCharacter(db, row.accountId, characterId, now).loaded;
      return { character: describeCharacter(refreshed, db) };
    }
    return { character: describeCharacter(loaded, db) };
  }

  if (type === 'kick') {
    const characterId = integer(body.characterId);
    const row = db.findCharacter(characterId);
    if (!row) throw new GameError('No such character.', 404);
    stopAdministrativeHunt(row.accountId, characterId);
    return { ok: true };
  }

  if (type === 'mute') {
    const target = integer(body.accountId);
    if (!db.findAccountById(target)) throw new GameError('Conta não encontrada.', 404);
    const minutes = integer(body.minutes ?? 30, 525_600);
    if (minutes < 1) throw new GameError('Valor numérico inválido.', 422);
    db.muteAccount(target, now + minutes * 60_000, String(body.reason ?? 'mute').slice(0, 500));
    return { ok: true, until: now + minutes * 60_000 };
  }

  if (type === 'unmute') {
    const target = integer(body.accountId);
    if (!db.findAccountById(target)) throw new GameError('Conta não encontrada.', 404);
    db.unmuteAccount(target);
    return { ok: true };
  }

  if (type === 'fulfill') {
    const orderId = integer(body.orderId);
    const order = db.findCoinOrder(orderId);
    if (!order) throw new GameError('Unknown order.', 404);
    if (String(order['status']) !== 'pending') throw new GameError('Order is not pending.', 409);
    const owner = integer(order['account_id']);
    const coins = integer(order['coins']);
    const first = db.charactersForAccount(owner)[0];
    if (!first) throw new GameError('A conta ainda não possui personagem para receber as Tibia Coins.', 409);
    const { loaded } = loadCharacter(db, owner, first.id, now);
    loaded.character.coins = (loaded.character.coins ?? 0) + coins;
    db.saveCharacter(loaded.row.id, JSON.stringify(loaded.character), loaded.session ? JSON.stringify(loaded.session) : null, now);
    db.setCoinOrderStatus(orderId, 'paid');
    return { ok: true, coins };
  }

  if (type === 'code') {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) throw new GameError('Invalid code.');
    db.createRedeemCode(
      code,
      integer(body.coins ?? 0),
      integer(body.gold ?? 0),
      integer(body.vipDays ?? 0, 3650),
    );
    return { ok: true, code };
  }

  if (type === 'beta') {
    const open = Boolean(body.open);
    db.setWorld('beta', open ? 'open' : 'closed');
    return { beta: open ? 'open' : 'closed' };
  }

  if (type === 'invite') {
    const code = String(body.code ?? '').trim().toUpperCase() || `BETA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) throw new GameError('Invalid invite.');
    db.createInvite(code);
    return { ok: true, code };
  }

  if (type === 'event') {
    const event = {
      name: String(body.name ?? ''),
      experience: Math.max(0.5, Math.min(3, Number(body.experience) || 1)),
      loot: Math.max(0.5, Math.min(3, Number(body.loot) || 1)),
    };
    db.setWorld('event', JSON.stringify(event));
    setWorldEvent(event);
    return { event };
  }

  throw new GameError('Unknown admin action.');
}
