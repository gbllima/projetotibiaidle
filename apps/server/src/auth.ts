import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
    throw new AuthError('Informe um email válido.');
  }
  return normalized;
}

export function register(db: Database, username: string, password: string, email?: string, invite?: string): AuthResult {
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError('Username must be 3-20 characters: letters, numbers, hyphen or underscore.');
  }
  if (password.length < 8) {
    throw new AuthError('Password must be at least 8 characters.');
  }
  const normalizedEmail = email ? requireEmail(email) : null;
  if (db.findAccount(username)) {
    throw new AuthError('That username is taken.', 409);
  }
  if (normalizedEmail && db.findAccountByEmail(normalizedEmail)) {
    throw new AuthError('Esse email já está em uso.', 409);
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
  const account = db.createAccount(username, hash(password, salt), salt, normalizedEmail);
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

export function claimAccount(db: Database, accountId: number, username: string, password: string, email?: string): AuthResult {
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
  const normalizedEmail = email ? requireEmail(email) : null;
  const emailOwner = normalizedEmail ? db.findAccountByEmail(normalizedEmail) : null;
  if (emailOwner && emailOwner.id !== accountId) {
    throw new AuthError('Esse email já está em uso.', 409);
  }
  const salt = randomBytes(16).toString('hex');
  db.updateAccount(accountId, username, hash(password, salt), salt);
  if (normalizedEmail) db.setAccountEmail(accountId, normalizedEmail);
  return issueToken(db, accountId, username);
}


export function requestPasswordReset(db: Database, email: string): { token: string; email: string; username: string } | null {
  const normalizedEmail = requireEmail(email);
  const account = db.findAccountByEmail(normalizedEmail);
  if (!account || isGuestUsername(account.username)) return null;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.createPasswordReset(tokenHash, account.id, PASSWORD_RESET_TTL_MS);
  return { token, email: normalizedEmail, username: account.username };
}

export function resetPassword(db: Database, token: string, password: string): AuthResult {
  if (password.length < 8) throw new AuthError('Password must be at least 8 characters.');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const accountId = db.passwordResetAccount(tokenHash);
  if (accountId === null) throw new AuthError('Link de recuperação inválido ou expirado.', 400);
  const account = db.findAccountById(accountId);
  if (!account) throw new AuthError('Conta não encontrada.', 404);
  const salt = randomBytes(16).toString('hex');
  db.updateAccount(account.id, account.username, hash(password, salt), salt);
  db.consumePasswordReset(tokenHash);
  db.revokeAccountTokens(account.id);
  return issueToken(db, account.id, account.username);
}

function socialUsername(db: Database, provider: string, email: string, displayName: string): string {
  const raw = (displayName || email.split('@')[0] || provider)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 16);
  const base = raw.length >= 3 ? raw : `${provider}_user`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? '' : `_${randomBytes(2).toString('hex')}`;
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!db.findAccount(candidate)) return candidate;
  }
  return `${provider}_${randomBytes(5).toString('hex')}`.slice(0, 20);
}

export function loginWithOauth(
  db: Database,
  provider: 'google' | 'discord',
  providerId: string,
  email: string,
  displayName: string,
): AuthResult {
  const normalizedEmail = requireEmail(email);
  const identity = db.findOauthIdentity(provider, providerId);
  if (identity) {
    const account = db.findAccountById(identity.accountId);
    if (!account) throw new AuthError('Conta vinculada não encontrada.', 404);
    return issueToken(db, account.id, account.username);
  }

  const existing = db.findAccountByEmail(normalizedEmail);
  if (existing) {
    db.linkOauthIdentity(provider, providerId, existing.id, normalizedEmail);
    return issueToken(db, existing.id, existing.username);
  }

  if (db.getWorld('beta') === 'closed') {
    throw new AuthError('Beta fechado: login social só está disponível para contas já cadastradas com este email.', 403);
  }

  const username = socialUsername(db, provider, normalizedEmail, displayName);
  const password = randomBytes(32).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const account = db.createAccount(username, hash(password, salt), salt, normalizedEmail);
  db.linkOauthIdentity(provider, providerId, account.id, normalizedEmail);
  return issueToken(db, account.id, account.username);
}

/**
 * Server-side administrator allow-list.
 * `gbllima` is always an administrator. Extra admins can be configured
 * explicitly with ADMIN_USERS. The historical `admin` test fixture is accepted
 * only while NODE_ENV=test, never in development or production.
 */
export function isAdminUsername(username: string): boolean {
  const normalized = username.trim().toLowerCase();
  if (normalized === 'gbllima') return true;
  if (process.env['NODE_ENV'] === 'test' && normalized === 'admin') return true;
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
