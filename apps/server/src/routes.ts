import { randomBytes } from 'node:crypto';
import { enterCity, moveCity } from './city.js';
import { partyPrincipal } from './party-access.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { meta } from '@tibia-idle/data';
import { TICK_MS, isBossHunt } from '@tibia-idle/sim';
import {
  accountFromHeader, AuthError, claimAccount, isGuestUsername, isAdminUsername, login, loginWithOauth,
  register, registerGuest, requestPasswordReset, resetPassword,
} from './auth.js';
import type { Database } from './db.js';
import {
  addPartyMember, configureParty, listBosses, listHunts, loadCharacter, lobbyPlayers, removePartyMember,
  sellPouch, stashPouch, startHunt, stopHunt, upgradeGear, takeAwaySummary,
} from './game.js';
import { worldSnapshot, type ActBody } from './systems.js';
import {
  economyAct, economyCharacterSlotCap, economyCharacterView, economyCreateNewCharacter, syncAccountEconomy,
} from './economy.js';
import { adminAct, adminSnapshot, requireAdmin } from './admin.js';
import { isBetaOpen, track } from './metrics.js';
import { FREE_OFFLINE_HOURS, GameError, MAX_OFFLINE_HOURS, publicSettlement, VIP_OFFLINE_HOURS, BOSS_TRIP_HOURS } from './settle.js';

/** REST surface. The WebSocket in ws.ts pushes the same shapes. */

interface Credentials {
  username?: unknown;
  password?: unknown;
  email?: unknown;
  invite?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GameError(`Missing "${field}".`);
  }
  return value;
}

function requireAccount(db: Database, request: FastifyRequest): number {
  const accountId = accountFromHeader(db, request.headers.authorization);
  if (accountId === null) throw new AuthError('Sign in first.', 401);
  return accountId;
}

function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError || error instanceof GameError) {
    return reply.status(error.status).send({ error: error.message });
  }
  reply.log.error(error);
  return reply.status(500).send({ error: 'Something went wrong.' });
}

export function registerRoutes(app: FastifyInstance, db: Database): void {
  const oauthStates = new Map<string, { provider: 'google' | 'discord'; expiresAt: number }>();
  const oauthCompletions = new Map<string, { token: string; expiresAt: number }>();
  const oauthTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of oauthStates) if (value.expiresAt <= now) oauthStates.delete(key);
    for (const [key, value] of oauthCompletions) if (value.expiresAt <= now) oauthCompletions.delete(key);
  }, 60_000);
  oauthTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(oauthTimer));

  const publicBase = (request: FastifyRequest) => {
    const configured = (process.env['PUBLIC_URL'] ?? '').trim().replace(/\/$/, '');
    if (configured) return configured;
    return `${request.protocol}://${request.headers.host ?? 'localhost:3000'}`;
  };
  const oauthEnabled = (provider: 'google' | 'discord') => provider === 'google'
    ? Boolean(process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET'])
    : Boolean(process.env['DISCORD_CLIENT_ID'] && process.env['DISCORD_CLIENT_SECRET']);

  app.get('/api/health', async () => ({
    ok: true,
    tickMs: TICK_MS,
    maxOfflineHours: MAX_OFFLINE_HOURS,
    freeOfflineHours: FREE_OFFLINE_HOURS,
    vipOfflineHours: VIP_OFFLINE_HOURS,
    content: meta.counts,
    generatedAt: meta.generatedAt,
    beta: isBetaOpen(db) ? 'open' : 'closed',
    oauth: { google: oauthEnabled('google'), discord: oauthEnabled('discord') },
    passwordRecovery: Boolean(process.env['RESEND_API_KEY'] && process.env['RESET_EMAIL_FROM']) || process.env['NODE_ENV'] !== 'production',
  }));

  app.post('/api/register', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Credentials;
      const invite = typeof body.invite === 'string' ? body.invite : undefined;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email : undefined;
      if (!email && process.env['NODE_ENV'] !== 'test') throw new GameError('Missing "email".');
      const result = register(
        db,
        asString(body.username, 'username'),
        asString(body.password, 'password'),
        email,
        invite,
      );
      track(db, 'register', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/guest', async (request, reply) => {
    try {
      const result = registerGuest(db);
      track(db, 'register', { accountId: result.accountId, extra: 'guest' });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/claim', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const body = (request.body ?? {}) as Credentials;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email : undefined;
      if (!email && process.env['NODE_ENV'] !== 'test') throw new GameError('Missing "email".');
      const result = claimAccount(
        db,
        accountId,
        asString(body.username, 'username'),
        asString(body.password, 'password'),
        email,
      );
      track(db, 'claim', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/login', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Credentials;
      const result = login(db, asString(body.username, 'username'), asString(body.password, 'password'));
      track(db, 'login', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/password/forgot', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { email?: unknown };
      const email = asString(body.email, 'email');
      const reset = requestPasswordReset(db, email);
      let devResetUrl: string | undefined;
      if (reset) {
        const resetUrl = `${publicBase(request)}/?reset=${encodeURIComponent(reset.token)}`;
        const apiKey = process.env['RESEND_API_KEY'];
        const from = process.env['RESET_EMAIL_FROM'];
        if (apiKey && from) {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              from,
              to: [reset.email],
              subject: 'Knock Hunt BR — Recuperar senha',
              html: `<p>Olá, ${reset.username}.</p><p>Use o link abaixo para criar uma nova senha. Ele expira em 30 minutos.</p><p><a href="${resetUrl}">Recuperar minha senha</a></p>`,
            }),
          });
          if (!response.ok) request.log.error({ status: response.status }, 'password reset email failed');
        } else if (process.env['NODE_ENV'] !== 'production') {
          devResetUrl = resetUrl;
        }
      }
      return reply.send({
        ok: true,
        message: 'Se o email estiver cadastrado, enviaremos as instruções de recuperação.',
        ...(devResetUrl ? { devResetUrl } : {}),
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/password/reset', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { token?: unknown; password?: unknown };
      const result = resetPassword(db, asString(body.token, 'token'), asString(body.password, 'password'));
      track(db, 'password_reset', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/oauth/:provider/start', async (request, reply) => {
    try {
      const provider = (request.params as { provider: string }).provider;
      if (provider !== 'google' && provider !== 'discord') throw new AuthError('Provedor inválido.', 404);
      if (!oauthEnabled(provider)) throw new AuthError(`Login com ${provider} ainda não foi configurado no servidor.`, 503);
      const state = randomBytes(24).toString('base64url');
      oauthStates.set(state, { provider, expiresAt: Date.now() + 10 * 60_000 });
      const redirectUri = `${publicBase(request)}/api/oauth/${provider}/callback`;
      if (provider === 'google') {
        const params = new URLSearchParams({
          client_id: process.env['GOOGLE_CLIENT_ID']!,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
          prompt: 'select_account',
        });
        return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
      }
      const params = new URLSearchParams({
        client_id: process.env['DISCORD_CLIENT_ID']!,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify email',
        state,
      });
      return reply.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/oauth/:provider/callback', async (request, reply) => {
    try {
      const provider = (request.params as { provider: string }).provider;
      if (provider !== 'google' && provider !== 'discord') throw new AuthError('Provedor inválido.', 404);
      const query = request.query as { code?: string; state?: string; error?: string };
      if (query.error) throw new AuthError('Login social cancelado.', 400);
      const code = asString(query.code, 'code');
      const state = asString(query.state, 'state');
      const pending = oauthStates.get(state);
      oauthStates.delete(state);
      if (!pending || pending.provider !== provider || pending.expiresAt < Date.now()) {
        throw new AuthError('Sessão de login social expirada.', 400);
      }
      const redirectUri = `${publicBase(request)}/api/oauth/${provider}/callback`;
      let providerId = '';
      let email = '';
      let displayName = '';
      if (provider === 'google') {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: process.env['GOOGLE_CLIENT_ID']!,
            client_secret: process.env['GOOGLE_CLIENT_SECRET']!,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenResponse.ok) throw new AuthError('Falha ao autenticar com Google.', 502);
        const tokenPayload = await tokenResponse.json() as { access_token?: string };
        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${tokenPayload.access_token ?? ''}` },
        });
        if (!profileResponse.ok) throw new AuthError('Falha ao consultar perfil do Google.', 502);
        const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
        if (!profile.sub || !profile.email || !profile.email_verified) throw new AuthError('O Google não forneceu um email verificado.', 400);
        providerId = profile.sub;
        email = profile.email;
        displayName = profile.name ?? '';
      } else {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: process.env['DISCORD_CLIENT_ID']!,
            client_secret: process.env['DISCORD_CLIENT_SECRET']!,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenResponse.ok) throw new AuthError('Falha ao autenticar com Discord.', 502);
        const tokenPayload = await tokenResponse.json() as { access_token?: string };
        const profileResponse = await fetch('https://discord.com/api/users/@me', {
          headers: { authorization: `Bearer ${tokenPayload.access_token ?? ''}` },
        });
        if (!profileResponse.ok) throw new AuthError('Falha ao consultar perfil do Discord.', 502);
        const profile = await profileResponse.json() as { id?: string; email?: string | null; verified?: boolean; global_name?: string | null; username?: string };
        if (!profile.id || !profile.email || !profile.verified) throw new AuthError('O Discord não forneceu um email verificado.', 400);
        providerId = profile.id;
        email = profile.email;
        displayName = profile.global_name ?? profile.username ?? '';
      }
      const result = loginWithOauth(db, provider, providerId, email, displayName);
      track(db, 'login', { accountId: result.accountId, extra: provider });
      const exchange = randomBytes(24).toString('base64url');
      oauthCompletions.set(exchange, { token: result.token, expiresAt: Date.now() + 2 * 60_000 });
      return reply.redirect(`${publicBase(request)}/?oauth_code=${encodeURIComponent(exchange)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no login social.';
      return reply.redirect(`${publicBase(request)}/?oauth_error=${encodeURIComponent(message)}`);
    }
  });

  app.get('/api/oauth/exchange', async (request, reply) => {
    const code = String((request.query as { code?: string }).code ?? '');
    const pending = oauthCompletions.get(code);
    oauthCompletions.delete(code);
    if (!pending || pending.expiresAt < Date.now()) return reply.status(400).send({ error: 'Login social expirado.' });
    return reply.send({ token: pending.token });
  });

  app.post('/api/logout', async (request, reply) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) db.deleteToken(header.slice(7).trim());
    return reply.send({ ok: true });
  });

  app.get('/api/characters', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const rows = db.charactersForAccount(accountId);
      const characters = rows.map((row) => {
        const { loaded } = loadCharacter(db, accountId, row.id);
        syncAccountEconomy(db, accountId, loaded);
        return economyCharacterView(db, accountId, loaded);
      });
      const account = db.findAccountById(accountId);
      const username = account?.username ?? '';
      return reply.send({
        characters,
        account: {
          username,
          email: account?.email ?? null,
          guest: isGuestUsername(username),
          admin: isAdminUsername(username),
          slots: economyCharacterSlotCap(db, accountId),
          used: rows.length,
        },
      });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/lobby', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.query as { characterId?: string }).characterId);
      let position;
      if (Number.isInteger(id) && id > 0) {
        const row = db.findCharacter(id);
        if (!row || row.accountId !== accountId) throw new GameError('Personagem inválido.', 404);
        if (row.session && JSON.parse(row.session).status === 'active') throw new GameError('Saia da hunt para entrar na cidade.', 409);
        position = enterCity(db, id);
      }
      return reply.send({ players: lobbyPlayers(db), position });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/lobby/move', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const body = request.body as { characterId?: number; x?: number; y?: number } | null;
      if (!body || !Number.isInteger(body.characterId) || !Number.isInteger(body.x) || !Number.isInteger(body.y)) throw new GameError('Posição inválida.');
      const row = db.findCharacter(body.characterId!);
      if (!row || row.accountId !== accountId) throw new GameError('Personagem inválido.', 404);
      if (row.session && JSON.parse(row.session).status === 'active') throw new GameError('Saia da hunt para andar na cidade.', 409);
      return reply.send(moveCity(db, body.characterId!, { x: body.x!, y: body.y! }));
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const body = (request.body ?? {}) as { name?: unknown; vocationId?: unknown; gender?: unknown; weapon?: unknown };
      const vocationId = Number(body.vocationId);
      if (!Number.isInteger(vocationId)) throw new GameError('Missing "vocationId".');
      const gender = body.gender === 'f' ? 'f' as const : 'm' as const;
      const weapon = body.weapon === 'axe' || body.weapon === 'club' ? body.weapon : 'sword';
      const loaded = economyCreateNewCharacter(db, accountId, asString(body.name, 'name'), vocationId, { gender, weapon });
      track(db, 'character_create', { accountId, characterId: loaded.row.id });
      return reply.status(201).send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/characters/:id', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, settlement } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), settlement: takeAwaySummary(db, id, settlement) });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/characters/:id/hunts', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ hunts: listHunts(partyPrincipal(db, loaded.row), db) });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/characters/:id/bosses', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ bosses: listBosses(partyPrincipal(db, loaded.row)) });
    } catch (error) { return fail(reply, error); }
  });

  app.put('/api/characters/:id/party', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const ownerId = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { memberIds?: unknown; primaryId?: unknown };
      if (!Array.isArray(body.memberIds) || !body.memberIds.every((id) => typeof id === 'number' && Number.isInteger(id))
        || typeof body.primaryId !== 'number' || !Number.isInteger(body.primaryId)) throw new GameError('Formação inválida.', 422);
      const id = configureParty(db, accountId, ownerId, body.memberIds, body.primaryId);
      const { loaded } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/party/members', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const ownerId = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { characterId?: unknown };
      const memberId = Number(body.characterId);
      if (!Number.isInteger(memberId)) throw new GameError('Missing "characterId".');
      addPartyMember(db, accountId, ownerId, memberId);
      const { loaded } = loadCharacter(db, accountId, ownerId);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/characters/:id/party/members/:memberId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; memberId: string };
      const ownerId = Number(params.id);
      removePartyMember(db, accountId, ownerId, Number(params.memberId));
      const { loaded } = loadCharacter(db, accountId, ownerId);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/hunt', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { huntId?: unknown; hours?: unknown };
      const huntId = asString(body.huntId, 'huntId');
      const rawHours = Number(body.hours);
      const hours = isBossHunt(huntId)
        ? BOSS_TRIP_HOURS
        : Number.isFinite(rawHours) ? Math.min(24, Math.max(1, Math.floor(rawHours))) : undefined;
      const loaded = startHunt(db, accountId, id, huntId, Date.now(), hours);
      syncAccountEconomy(db, accountId, loaded);
      track(db, loaded.session ? 'hunt_start' : 'hunt_queued', { accountId, characterId: id, extra: huntId });
      return reply.send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/characters/:id/hunt', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, gold, refund } = stopHunt(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      track(db, 'hunt_stop', { accountId, characterId: id, value: gold });
      return reply.send({ character: economyCharacterView(db, accountId, loaded), goldBanked: gold, supplyRefund: refund });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/sell', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, gold } = sellPouch(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), gold });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/stash', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, items } = stashPouch(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), items });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/gear', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, spent } = upgradeGear(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), spent });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/characters/:id/act', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as ActBody;
      const { loaded, targetLoaded, extra } = economyAct(db, accountId, id, body);
      track(db, `act:${String(body.type ?? 'unknown')}`, {
        accountId,
        characterId: id,
        value: Number(extra?.['gold'] ?? 0),
      });
      return reply.send({
        character: economyCharacterView(db, accountId, loaded),
        targetCharacter: targetLoaded ? economyCharacterView(db, accountId, targetLoaded) : undefined,
        ...extra,
      });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/world', async (request, reply) => {
    try {
      requireAccount(db, request);
      const channel = String((request.query as { channel?: string }).channel ?? 'geral');
      return reply.send(worldSnapshot(db, channel));
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/admin', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      requireAdmin(db, accountId);
      return reply.send(adminSnapshot(db));
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/admin', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      return reply.send(adminAct(db, accountId, (request.body ?? {}) as Record<string, unknown>));
    } catch (error) { return fail(reply, error); }
  });
}
