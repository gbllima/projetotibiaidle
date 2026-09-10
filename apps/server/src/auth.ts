import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from './db.js';

/**
 * Accounts and bearer tokens.
 *
 * scrypt with a per-account salt, and comparisons through `timingSafeEqual` so
 * a wrong password cannot be distinguished from a wrong username by timing.
 */

const KEY_LENGTH = 64;
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hash(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LENGTH).toString('hex');
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hash(password, salt), 'hex');
  const target = Buffer.from(expected, 'hex');
  if (actual.length !== target.length) return false;
  return timingSafeEqual(actual, target);
}

export interface AuthResult {
  token: string;
  accountId: number;
  username: string;
  guest?: boolean;
}

export function isGuestUsername(username: string): boolean {
  return username.toLowerCase().startsWith('guest_');
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'AuthError';
  }
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

export function register(db: Database, username: string, password: string, invite?: string): AuthResult {
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError('Username must be 3-20 characters: letters, numbers, hyphen or underscore.');
  }
  if (password.length < 8) {
    throw new AuthError('Password must be at least 8 characters.');
  }
  if (db.findAccount(username)) {
    throw new AuthError('That username is taken.', 409);
  }

  const closed = db.getWorld('beta') === 'closed';
  const needsInvite = closed && !isAdminUsername(username);
  let inviteCode: string | null = null;
  if (needsInvite) {
    const code = (invite ?? '').trim().toUpperCase();
    const row = code ? db.findInvite(code) : undefined;
    if (!row || row['used_by']) {
      throw new AuthError('Beta is closed. A valid invite code is required.', 403);
    }
    inviteCode = code;
  }

  const salt = randomBytes(16).toString('hex');
  const account = db.createAccount(username, hash(password, salt), salt);
  if (inviteCode) db.useInvite(inviteCode, account.id);
  return issueToken(db, account.id, account.username);
}

export function login(db: Database, username: string, password: string): AuthResult {
  const account = db.findAccount(username);
  // Hash regardless of whether the account exists, so both paths cost the same.
  const salt = account?.salt ?? 'missing-account-placeholder-salt';
  const expected = account?.passwordHash ?? hash('', salt);
  const ok = verifyPassword(password, salt, expected);

  if (!account || !ok) throw new AuthError('Incorrect username or password.', 401);
  if (db.getWorld('ban:' + account.id)) throw new AuthError('Conta banida. Entre em contato com a administração.', 403);
  return issueToken(db, account.id, account.username);
}

export function issueToken(db: Database, accountId: number, username: string): AuthResult {
  const token = randomBytes(32).toString('base64url');
  db.createToken(token, accountId, TOKEN_TTL_MS);
  return { token, accountId, username, guest: isGuestUsername(username) };
}

/** Play first, register later. Skips the beta invite on purpose (doc 01 §5). */
export function registerGuest(db: Database): AuthResult {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = `guest_${randomBytes(6).toString('hex')}`;
    if (db.findAccount(username)) continue;
    const password = randomBytes(16).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const account = db.createAccount(username, hash(password, salt), salt);
    return issueToken(db, account.id, account.username);
  }
  throw new AuthError('Could not create a guest account.', 500);
}

export function claimAccount(db: Database, accountId: number, username: string, password: string): AuthResult {
  const account = db.findAccountById(accountId);
  if (!account || !isGuestUsername(account.username)) {
    throw new AuthError('This account is already claimed.', 409);
  }
  if (!USERNAME_PATTERN.test(username) || isGuestUsername(username)) {
    throw new AuthError('Username must be 3-20 characters: letters, numbers, hyphen or underscore.');
  }
  if (password.length < 8) {
    throw new AuthError('Password must be at least 8 characters.');
  }
  if (db.findAccount(username)) {
    throw new AuthError('That username is taken.', 409);
  }
  const salt = randomBytes(16).toString('hex');
  db.updateAccount(accountId, username, hash(password, salt), salt);
  return issueToken(db, accountId, username);
}

/**
 * Server-side administrator allow-list.
 * `gbllima` is always an administrator. Extra admins can be configured
 * explicitly with ADMIN_USERS; there is intentionally no generic "admin"
 * fallback account.
 */
export function isAdminUsername(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  if (normalized === 'gbllima') return true;
  const listed = (process.env['ADMIN_USERS'] ?? '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return listed.includes(normalized);
}

/** Reads `Authorization: Bearer <token>` and resolves it to an account. */
export function accountFromHeader(db: Database, header: string | undefined): number | null {
  if (!header?.startsWith('Bearer ')) return null;
  const id = db.accountIdForToken(header.slice('Bearer '.length).trim());
  if (id !== null && db.getWorld('ban:' + id)) throw new AuthError('Conta banida.', 403);
  return id;
}
