import { setWorldEvent, type CharacterState } from '@tibia-idle/sim';
import { isAdminUsername } from './auth.js';
import type { Database } from './db.js';
import { describeCharacter, loadCharacter } from './game.js';
import { metricsSnapshot } from './metrics.js';
import { GameError } from './settle.js';

export { isAdminUsername };

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
    characters: db.charactersForAccount(account.id).map((row) => {
      const state = JSON.parse(row.state) as CharacterState;
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

  if (type === 'grant') {
    const characterId = Number(body.characterId);
    const row = db.findCharacter(characterId);
    if (!row) throw new GameError('No such character.', 404);
    const { loaded } = loadCharacter(db, row.accountId, characterId, now);
    const gold = Math.max(0, Math.floor(Number(body.gold) || 0));
    const coins = Math.max(0, Math.floor(Number(body.coins) || 0));
    const vipDays = Math.max(0, Math.floor(Number(body.vipDays) || 0));
    loaded.character.gold += gold;
    loaded.character.coins += coins;
    if (vipDays > 0) {
      loaded.character.premium = true;
      loaded.character.vipUntil = Math.max(loaded.character.vipUntil ?? 0, now) + vipDays * 86_400_000;
    }
    db.saveCharacter(loaded.row.id, JSON.stringify(loaded.character), loaded.session ? JSON.stringify(loaded.session) : null, now);
    return { character: describeCharacter(loaded, db) };
  }

  if (type === 'kick') {
    const characterId = Number(body.characterId);
    const row = db.findCharacter(characterId);
    if (!row) throw new GameError('No such character.', 404);
    const { loaded } = loadCharacter(db, row.accountId, characterId, now);
    loaded.session = null;
    db.saveCharacter(loaded.row.id, JSON.stringify(loaded.character), null, now);
    db.releaseHunt(characterId);
    db.dequeueHunt(characterId);
    return { ok: true };
  }

  if (type === 'mute') {
    const target = Number(body.accountId);
    const minutes = Math.max(1, Math.floor(Number(body.minutes) || 30));
    db.muteAccount(target, now + minutes * 60_000, String(body.reason ?? 'mute'));
    return { ok: true, until: now + minutes * 60_000 };
  }

  if (type === 'unmute') {
    db.unmuteAccount(Number(body.accountId));
    return { ok: true };
  }

  if (type === 'fulfill') {
    const order = db.findCoinOrder(Number(body.orderId));
    if (!order) throw new GameError('Unknown order.', 404);
    if (String(order['status']) !== 'pending') throw new GameError('Order is not pending.', 409);
    const owner = Number(order['account_id']);
    const coins = Number(order['coins']);
    const chars = db.charactersForAccount(owner);
    const first = chars[0];
    if (first) {
      const state = JSON.parse(first.state) as CharacterState;
      state.coins = (state.coins ?? 0) + coins;
      db.saveCharacter(first.id, JSON.stringify(state), first.session, now);
    }
    db.setCoinOrderStatus(Number(order['id']), 'paid');
    return { ok: true, coins };
  }

  if (type === 'code') {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) throw new GameError('Invalid code.');
    db.createRedeemCode(code, Math.max(0, Number(body.coins) || 0), Math.max(0, Number(body.gold) || 0), Math.max(0, Number(body.vipDays) || 0));
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
