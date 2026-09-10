import { partyPrincipal } from './party-access.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { meta } from '@tibia-idle/data';
import { TICK_MS, isBossHunt } from '@tibia-idle/sim';
import { accountFromHeader, AuthError, claimAccount, isGuestUsername, isAdminUsername, login, register, registerGuest } from './auth.js';
import type { Database } from './db.js';
import {
  addPartyMember, configureParty, characterSlotCap, createNewCharacter, listBosses, listHunts, loadCharacter, lobbyPlayers, removePartyMember,
  sellPouch, stashPouch, startHunt, stopHunt, upgradeGear,
} from './game.js';
import { worldSnapshot, type ActBody } from './systems.js';
import { economyAct, economyCharacterView, finalizeNewCharacterEconomy, syncAccountEconomy } from './economy.js';
import { adminAct, adminSnapshot, requireAdmin } from './admin.js';
import { isBetaOpen, track } from './metrics.js';
import { FREE_OFFLINE_HOURS, GameError, MAX_OFFLINE_HOURS, publicSettlement, VIP_OFFLINE_HOURS, BOSS_TRIP_HOURS } from './settle.js';

/** REST surface. The WebSocket in ws.ts pushes the same shapes. */

interface Credentials {
  username?: unknown;
  password?: unknown;
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

/** Expected failures carry a message for the player; anything else is a bug. */
function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError || error instanceof GameError) {
    return reply.status(error.status).send({ error: error.message });
  }
  reply.log.error(error);
  return reply.status(500).send({ error: 'Something went wrong.' });
}

export function registerRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/health', async () => ({
    ok: true,
    tickMs: TICK_MS,
    maxOfflineHours: MAX_OFFLINE_HOURS,
    freeOfflineHours: FREE_OFFLINE_HOURS,
    vipOfflineHours: VIP_OFFLINE_HOURS,
    content: meta.counts,
    generatedAt: meta.generatedAt,
    beta: isBetaOpen(db) ? 'open' : 'closed',
  }));

  app.post('/api/register', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Credentials;
      const invite = typeof body.invite === 'string' ? body.invite : undefined;
      const result = register(db, asString(body.username, 'username'), asString(body.password, 'password'), invite);
      track(db, 'register', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guest', async (request, reply) => {
    try {
      const result = registerGuest(db);
      track(db, 'register', { accountId: result.accountId, extra: 'guest' });
      return reply.send(result);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/claim', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const body = (request.body ?? {}) as Credentials;
      const result = claimAccount(
        db,
        accountId,
        asString(body.username, 'username'),
        asString(body.password, 'password'),
      );
      track(db, 'claim', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/login', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Credentials;
      const result = login(db, asString(body.username, 'username'), asString(body.password, 'password'));
      track(db, 'login', { accountId: result.accountId });
      return reply.send(result);
    } catch (error) {
      return fail(reply, error);
    }
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
          guest: isGuestUsername(username),
          admin: isAdminUsername(username),
          slots: characterSlotCap(db, accountId),
          used: rows.length,
        },
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/lobby', async (request, reply) => {
    try {
      requireAccount(db, request);
      return reply.send({ players: lobbyPlayers(db) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const body = (request.body ?? {}) as {
        name?: unknown; vocationId?: unknown; gender?: unknown; weapon?: unknown;
      };
      const vocationId = Number(body.vocationId);
      if (!Number.isInteger(vocationId)) throw new GameError('Missing "vocationId".');
      const gender = body.gender === 'f' ? 'f' as const : 'm' as const;
      const weapon = body.weapon === 'axe' || body.weapon === 'club' ? body.weapon : 'sword';

      const loaded = finalizeNewCharacterEconomy(
        db,
        accountId,
        createNewCharacter(db, accountId, asString(body.name, 'name'), vocationId, { gender, weapon }),
      );
      track(db, 'character_create', { accountId, characterId: loaded.row.id });
      return reply.status(201).send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/characters/:id', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, settlement } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({
        character: economyCharacterView(db, accountId, loaded),
        settlement: publicSettlement(settlement),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/characters/:id/hunts', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ hunts: listHunts(partyPrincipal(db, loaded.row), db) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/characters/:id/bosses', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded } = loadCharacter(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ bosses: listBosses(partyPrincipal(db, loaded.row)) });
    } catch (error) {
      return fail(reply, error);
    }
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
    } catch (error) {
      return fail(reply, error);
    }
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
    } catch (error) {
      return fail(reply, error);
    }
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
        : Number.isFinite(rawHours)
          ? Math.min(24, Math.max(1, Math.floor(rawHours)))
          : undefined;
      const loaded = startHunt(db, accountId, id, huntId, Date.now(), hours);
      syncAccountEconomy(db, accountId, loaded);
      track(db, loaded.session ? 'hunt_start' : 'hunt_queued', { accountId, characterId: id, extra: huntId });
      return reply.send({ character: economyCharacterView(db, accountId, loaded) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete('/api/characters/:id/hunt', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, gold, refund } = stopHunt(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      track(db, 'hunt_stop', { accountId, characterId: id, value: gold });
      return reply.send({ character: economyCharacterView(db, accountId, loaded), goldBanked: gold, supplyRefund: refund });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/sell', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, gold } = sellPouch(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), gold });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/stash', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, items } = stashPouch(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), items });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/gear', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded, spent } = upgradeGear(db, accountId, id);
      syncAccountEconomy(db, accountId, loaded);
      return reply.send({ character: economyCharacterView(db, accountId, loaded), spent });
    } catch (error) {
      return fail(reply, error);
    }
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
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/world', async (request, reply) => {
    try {
      requireAccount(db, request);
      const channel = String((request.query as { channel?: string }).channel ?? 'geral');
      return reply.send(worldSnapshot(db, channel));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/admin', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      requireAdmin(db, accountId);
      return reply.send(adminSnapshot(db));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/admin', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      return reply.send(adminAct(db, accountId, (request.body ?? {}) as Record<string, unknown>));
    } catch (error) {
      return fail(reply, error);
    }
  });
}
