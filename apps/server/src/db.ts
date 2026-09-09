import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * Persistence.
 *
 * SQLite through Node's built-in driver, so the server runs with no database to
 * install and no native module to compile. The access layer below is small and
 * SQL-only on purpose: moving to PostgreSQL later means rewriting this file
 * rather than untangling an ORM from the rest of the codebase.
 *
 * A character's hunt session is stored as a JSON blob. It is a plain, fully
 * serialisable value produced by the simulation, and nothing else queries
 * inside it, so giving it columns would buy nothing.
 */

export interface AccountRow {
  id: number;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
}

export interface CharacterRow {
  id: number;
  accountId: number;
  name: string;
  vocationId: number;
  /** Serialised CharacterState. */
  state: string;
  /** Serialised HuntSession, or null when not hunting. */
  session: string | null;
  /** Wall clock of the last settlement, in milliseconds. */
  settledAt: number;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL UNIQUE,
  vocation_id INTEGER NOT NULL,
  state       TEXT    NOT NULL,
  session     TEXT,
  settled_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);

CREATE TABLE IF NOT EXISTS market (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  seller_name TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  count INTEGER NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  leader_id INTEGER NOT NULL,
  motd TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL UNIQUE,
  character_name TEXT NOT NULL,
  rank TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS arena (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker TEXT NOT NULL,
  defender TEXT NOT NULL,
  winner TEXT NOT NULL,
  gold INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hunt_occupancy (
  hunt_id TEXT NOT NULL,
  character_id INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hunt_queue (
  hunt_id TEXT NOT NULL,
  character_id INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  pack_id TEXT NOT NULL,
  coins INTEGER NOT NULL,
  brl INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  code TEXT PRIMARY KEY,
  coins INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  vip_days INTEGER NOT NULL,
  used_by INTEGER,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutes (
  account_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER,
  character_id INTEGER,
  value INTEGER NOT NULL DEFAULT 0,
  extra TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS telemetry_name_time ON telemetry(name, created_at);
CREATE INDEX IF NOT EXISTS telemetry_account_time ON telemetry(account_id, created_at);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  used_by INTEGER,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
`;

// Node lists the SQLite driver in `builtinModules` only under its prefixed
// name, which is enough to make bundlers treat `node:sqlite` as a package on
// disk and fail to resolve it. Requiring it at runtime sidesteps that.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export class Database {
  private readonly db: DatabaseSyncType;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createAccount(username: string, passwordHash: string, salt: string): AccountRow {
    const now = Date.now();
    this.db
      .prepare('INSERT INTO accounts (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)')
      .run(username, passwordHash, salt, now);
    const account = this.findAccount(username);
    if (!account) throw new Error('account insert did not persist');
    return account;
  }

  findAccount(username: string): AccountRow | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, salt, created_at FROM accounts WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    return row ? this.toAccount(row) : null;
  }

  findAccountById(id: number): AccountRow | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, salt, created_at FROM accounts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toAccount(row) : null;
  }

  updateAccount(id: number, username: string, passwordHash: string, salt: string): void {
    this.db
      .prepare('UPDATE accounts SET username = ?, password_hash = ?, salt = ? WHERE id = ?')
      .run(username, passwordHash, salt, id);
  }

  private toAccount(row: Record<string, unknown>): AccountRow {
    return {
      id: Number(row['id']),
      username: String(row['username']),
      passwordHash: String(row['password_hash']),
      salt: String(row['salt']),
      createdAt: Number(row['created_at']),
    };
  }

  listAccounts(): AccountRow[] {
    const rows = this.db
      .prepare('SELECT id, username, password_hash, salt, created_at FROM accounts ORDER BY id')
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.toAccount(row));
  }

  createToken(token: string, accountId: number, ttlMs: number): void {
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, accountId, now, now + ttlMs);
  }

  accountIdForToken(token: string): number | null {
    const row = this.db
      .prepare('SELECT account_id, expires_at FROM sessions WHERE token = ?')
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (Number(row['expires_at']) < Date.now()) {
      this.deleteToken(token);
      return null;
    }
    return Number(row['account_id']);
  }

  deleteToken(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  createCharacter(accountId: number, name: string, vocationId: number, state: string): CharacterRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO characters (account_id, name, vocation_id, state, session, settled_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(accountId, name, vocationId, state, now, now);
    const character = this.findCharacterByName(name);
    if (!character) throw new Error('character insert did not persist');
    return character;
  }

  private toCharacter(row: Record<string, unknown>): CharacterRow {
    return {
      id: Number(row['id']),
      accountId: Number(row['account_id']),
      name: String(row['name']),
      vocationId: Number(row['vocation_id']),
      state: String(row['state']),
      session: row['session'] === null || row['session'] === undefined ? null : String(row['session']),
      settledAt: Number(row['settled_at']),
      createdAt: Number(row['created_at']),
    };
  }

  private readonly characterColumns =
    'id, account_id, name, vocation_id, state, session, settled_at, created_at';

  findCharacterByName(name: string): CharacterRow | null {
    const row = this.db
      .prepare(`SELECT ${this.characterColumns} FROM characters WHERE name = ?`)
      .get(name) as Record<string, unknown> | undefined;
    return row ? this.toCharacter(row) : null;
  }

  findCharacter(id: number): CharacterRow | null {
    const row = this.db
      .prepare(`SELECT ${this.characterColumns} FROM characters WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toCharacter(row) : null;
  }

  charactersForAccount(accountId: number): CharacterRow[] {
    const rows = this.db
      .prepare(`SELECT ${this.characterColumns} FROM characters WHERE account_id = ? ORDER BY id`)
      .all(accountId) as Record<string, unknown>[];
    return rows.map((row) => this.toCharacter(row));
  }

  saveCharacter(id: number, state: string, session: string | null, settledAt: number): void {
    this.db
      .prepare('UPDATE characters SET state = ?, session = ?, settled_at = ? WHERE id = ?')
      .run(state, session, settledAt, id);
  }

  updateVocationId(id: number, vocationId: number): void {
    this.db.prepare('UPDATE characters SET vocation_id = ? WHERE id = ?').run(vocationId, id);
  }

  allCharacters(): CharacterRow[] {
    const rows = this.db
      .prepare(`SELECT ${this.characterColumns} FROM characters ORDER BY id`)
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.toCharacter(row));
  }

  insertMarket(listing: {
    sellerId: number; sellerName: string; itemId: number; count: number; price: number; currency: string;
  }): number {
    const result = this.db
      .prepare('INSERT INTO market (seller_id, seller_name, item_id, count, price, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(listing.sellerId, listing.sellerName, listing.itemId, listing.count, listing.price, listing.currency, Date.now());
    return Number(result.lastInsertRowid);
  }

  listMarket(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM market ORDER BY id DESC LIMIT 80').all() as Record<string, unknown>[];
  }

  findMarket(id: number): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM market WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  }

  deleteMarket(id: number): void {
    this.db.prepare('DELETE FROM market WHERE id = ?').run(id);
  }

  insertGuild(name: string, leaderId: number, motd: string): number {
    const result = this.db
      .prepare('INSERT INTO guilds (name, leader_id, motd, created_at) VALUES (?, ?, ?, ?)')
      .run(name, leaderId, motd, Date.now());
    return Number(result.lastInsertRowid);
  }

  findGuild(id: number): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM guilds WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  }

  findGuildByName(name: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM guilds WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  }

  listGuilds(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM guilds ORDER BY id').all() as Record<string, unknown>[];
  }

  addGuildMember(guildId: number, characterId: number, name: string, rank: string): void {
    this.db
      .prepare('INSERT INTO guild_members (guild_id, character_id, character_name, rank) VALUES (?, ?, ?, ?)')
      .run(guildId, characterId, name, rank);
  }

  guildMembers(guildId: number): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM guild_members WHERE guild_id = ?').all(guildId) as Record<string, unknown>[];
  }

  removeGuildMember(guildId: number, characterId: number): void {
    this.db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND character_id = ?').run(guildId, characterId);
  }

  setGuildMemberRank(guildId: number, characterId: number, rank: string): void {
    this.db.prepare('UPDATE guild_members SET rank = ? WHERE guild_id = ? AND character_id = ?').run(rank, guildId, characterId);
  }

  setGuildLeader(guildId: number, characterId: number): void {
    this.db.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?').run(characterId, guildId);
  }

  deleteGuild(guildId: number): void {
    this.db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(guildId);
    this.db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId);
  }

  listHuntHunters(huntId: string): Array<{
    id: number;
    name: string;
    level: number;
    vocationId: number;
    appearance?: { outfit: number; head: number; body: number; legs: number; feet: number; aura: number; mount: number; addons?: number };
  }> {
    const rows = this.db
      .prepare('SELECT character_id FROM hunt_occupancy WHERE hunt_id = ? ORDER BY created_at')
      .all(huntId) as Array<{ character_id: number }>;
    const hunters = [];
    for (const entry of rows) {
      const row = this.findCharacter(Number(entry.character_id));
      if (!row?.session) continue;
      let session: { status?: string; huntId?: string; character?: Record<string, unknown> };
      try {
        session = JSON.parse(row.session) as typeof session;
      } catch {
        continue;
      }
      // Ghost filter: only live active hunts in this cave.
      if (session.status !== 'active' || session.huntId !== huntId) continue;
      const live = session.character ?? (JSON.parse(row.state) as Record<string, unknown>);
      hunters.push({
        id: row.id,
        name: String(live['name'] ?? row.name),
        level: Number(live['level']) || 8,
        vocationId: row.vocationId,
        appearance: live['appearance'] as {
          outfit: number; head: number; body: number; legs: number; feet: number; aura: number; mount: number;
        } | undefined,
      });
    }
    return hunters;
  }

  /** Every occupancy row — used by hunt reconcile on boot. */
  listAllOccupancy(): Array<{ huntId: string; characterId: number }> {
    const rows = this.db
      .prepare('SELECT hunt_id, character_id FROM hunt_occupancy')
      .all() as Array<{ hunt_id: string; character_id: number }>;
    return rows.map((row) => ({ huntId: String(row.hunt_id), characterId: Number(row.character_id) }));
  }

  insertChat(channel: string, author: string, body: string): void {
    this.db.prepare('INSERT INTO chat (channel, author, body, created_at) VALUES (?, ?, ?, ?)').run(channel, author, body, Date.now());
  }

  listChat(channel: string, limit = 40): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT * FROM chat WHERE channel = ? ORDER BY id DESC LIMIT ?')
      .all(channel, limit) as Record<string, unknown>[];
  }

  insertArena(attacker: string, defender: string, winner: string, gold: number): void {
    this.db.prepare('INSERT INTO arena (attacker, defender, winner, gold, created_at) VALUES (?, ?, ?, ?, ?)').run(attacker, defender, winner, gold, Date.now());
  }

  listArena(limit = 20): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM arena ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  }

  occupyHunt(huntId: string, characterId: number): void {
    this.db.prepare('INSERT OR REPLACE INTO hunt_occupancy (hunt_id, character_id, created_at) VALUES (?, ?, ?)').run(huntId, characterId, Date.now());
  }

  releaseHunt(characterId: number): string | null {
    const row = this.db.prepare('SELECT hunt_id FROM hunt_occupancy WHERE character_id = ?').get(characterId) as Record<string, unknown> | undefined;
    this.db.prepare('DELETE FROM hunt_occupancy WHERE character_id = ?').run(characterId);
    return row ? String(row['hunt_id']) : null;
  }

  huntOccupancy(huntId: string): number {
    return this.listHuntHunters(huntId).length;
  }

  occupancyByHunt(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const huntId of new Set(this.listAllOccupancy().map((row) => row.huntId))) {
      const n = this.listHuntHunters(huntId).length;
      if (n > 0) counts[huntId] = n;
    }
    return counts;
  }

  enqueueHunt(huntId: string, characterId: number): void {
    this.db.prepare('INSERT OR REPLACE INTO hunt_queue (hunt_id, character_id, created_at) VALUES (?, ?, ?)').run(huntId, characterId, Date.now());
  }

  dequeueHunt(characterId: number): string | null {
    const row = this.db.prepare('SELECT hunt_id FROM hunt_queue WHERE character_id = ?').get(characterId) as Record<string, unknown> | undefined;
    this.db.prepare('DELETE FROM hunt_queue WHERE character_id = ?').run(characterId);
    return row ? String(row['hunt_id']) : null;
  }

  queuedHunt(characterId: number): { huntId: string; position: number; size: number } | null {
    const row = this.db.prepare('SELECT hunt_id, created_at FROM hunt_queue WHERE character_id = ?').get(characterId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const huntId = String(row['hunt_id']);
    const created = Number(row['created_at']);
    const ahead = this.db.prepare('SELECT COUNT(*) AS n FROM hunt_queue WHERE hunt_id = ? AND created_at <= ?').get(huntId, created) as { n: number };
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM hunt_queue WHERE hunt_id = ?').get(huntId) as { n: number };
    return { huntId, position: Number(ahead.n), size: Number(total.n) };
  }

  nextQueued(huntId: string): number | null {
    const row = this.db.prepare('SELECT character_id FROM hunt_queue WHERE hunt_id = ? ORDER BY created_at LIMIT 1').get(huntId) as Record<string, unknown> | undefined;
    return row ? Number(row['character_id']) : null;
  }

  queueByHunt(): Record<string, number> {
    const rows = this.db.prepare('SELECT hunt_id, COUNT(*) AS n FROM hunt_queue GROUP BY hunt_id').all() as Array<{ hunt_id: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.hunt_id, Number(row.n)]));
  }

  createCoinOrder(accountId: number, packId: string, coins: number, brl: number): number {
    const result = this.db
      .prepare('INSERT INTO coin_orders (account_id, pack_id, coins, brl, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, packId, coins, brl, 'pending', Date.now());
    return Number(result.lastInsertRowid);
  }

  listCoinOrders(status?: string): Array<Record<string, unknown>> {
    if (status) {
      return this.db.prepare('SELECT * FROM coin_orders WHERE status = ? ORDER BY id DESC LIMIT 50').all(status) as Record<string, unknown>[];
    }
    return this.db.prepare('SELECT * FROM coin_orders ORDER BY id DESC LIMIT 50').all() as Record<string, unknown>[];
  }

  findCoinOrder(id: number): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM coin_orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  }

  setCoinOrderStatus(id: number, status: string): void {
    this.db.prepare('UPDATE coin_orders SET status = ? WHERE id = ?').run(status, id);
  }

  createRedeemCode(code: string, coins: number, gold: number, vipDays: number): void {
    this.db.prepare('INSERT INTO redeem_codes (code, coins, gold, vip_days, used_by, used_at) VALUES (?, ?, ?, ?, NULL, NULL)')
      .run(code.toUpperCase(), coins, gold, vipDays);
  }

  findRedeemCode(code: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code.toUpperCase()) as Record<string, unknown> | undefined;
  }

  useRedeemCode(code: string, accountId: number): void {
    this.db.prepare('UPDATE redeem_codes SET used_by = ?, used_at = ? WHERE code = ?').run(accountId, Date.now(), code.toUpperCase());
  }

  getWorld(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM world_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setWorld(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO world_state (key, value) VALUES (?, ?)').run(key, value);
  }

  worldKeys(prefix: string): string[] {
    const rows = this.db.prepare('SELECT key FROM world_state WHERE key LIKE ?').all(`${prefix}%`) as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  muteAccount(accountId: number, until: number, reason: string): void {
    this.db.prepare('INSERT OR REPLACE INTO mutes (account_id, until, reason) VALUES (?, ?, ?)').run(accountId, until, reason);
  }

  unmuteAccount(accountId: number): void {
    this.db.prepare('DELETE FROM mutes WHERE account_id = ?').run(accountId);
  }

  muteUntil(accountId: number): { until: number; reason: string } | null {
    const row = this.db.prepare('SELECT until, reason FROM mutes WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const until = Number(row['until']);
    if (until <= Date.now()) {
      this.unmuteAccount(accountId);
      return null;
    }
    return { until, reason: String(row['reason']) };
  }

  track(name: string, fields: { accountId?: number; characterId?: number; value?: number; extra?: string; at?: number } = {}): void {
    this.db.prepare(
      'INSERT INTO telemetry (name, account_id, character_id, value, extra, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(name, fields.accountId ?? null, fields.characterId ?? null, fields.value ?? 0, fields.extra ?? null, fields.at ?? Date.now());
  }

  countAccounts(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n);
  }

  telemetrySince(since: number): Array<{ name: string; n: number; value: number }> {
    return this.db.prepare(
      'SELECT name, COUNT(*) AS n, COALESCE(SUM(value), 0) AS value FROM telemetry WHERE created_at >= ? GROUP BY name',
    ).all(since) as Array<{ name: string; n: number; value: number }>;
  }

  distinctAccountsSince(since: number): number {
    return Number((this.db.prepare(
      'SELECT COUNT(DISTINCT account_id) AS n FROM telemetry WHERE created_at >= ? AND account_id IS NOT NULL',
    ).get(since) as { n: number }).n);
  }

  topHuntStarts(since: number, limit = 8): Array<{ huntId: string; n: number }> {
    return this.db.prepare(
      'SELECT extra AS huntId, COUNT(*) AS n FROM telemetry WHERE name = ? AND created_at >= ? AND extra IS NOT NULL GROUP BY extra ORDER BY n DESC LIMIT ?',
    ).all('hunt_start', since, limit) as Array<{ huntId: string; n: number }>;
  }

  accountsCreatedBetween(from: number, to: number): number[] {
    const rows = this.db.prepare('SELECT id FROM accounts WHERE created_at >= ? AND created_at < ?').all(from, to) as Array<{ id: number }>;
    return rows.map((row) => Number(row.id));
  }

  accountsActiveSince(ids: number[], since: number): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const row = this.db.prepare(
      `SELECT COUNT(DISTINCT account_id) AS n FROM telemetry WHERE created_at >= ? AND account_id IN (${placeholders})`,
    ).get(since, ...ids) as { n: number };
    return Number(row.n);
  }

  createInvite(code: string): void {
    this.db.prepare('INSERT INTO invites (code, used_by, used_at, created_at) VALUES (?, NULL, NULL, ?)').run(code.toUpperCase(), Date.now());
  }

  findInvite(code: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code.toUpperCase()) as Record<string, unknown> | undefined;
  }

  useInvite(code: string, accountId: number): void {
    this.db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(accountId, Date.now(), code.toUpperCase());
  }

  listInvites(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 40').all() as Record<string, unknown>[];
  }
}
