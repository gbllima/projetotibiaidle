import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { itemsById } from '@tibia-idle/data';
import { addItemStack, moveStackToBackpack } from '@tibia-idle/sim';
import { accountFromHeader, AuthError } from './auth.js';
import type { Database } from './db.js';
import { describeCharacter, loadCharacter } from './game.js';
import { GameError } from './settle.js';

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

function takeStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || stack.count < count) throw new GameError('You do not have that item.', 400);
  stack.count -= count;
  if (stack.count <= 0) list.splice(list.indexOf(stack), 1);
}

export function registerDepotTransferRoutes(app: FastifyInstance, db: Database): void {
  app.post('/api/characters/:id/depot-to-backpack', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { itemId?: unknown; count?: unknown };
      const itemId = Number(body.itemId);
      const count = Math.max(1, Math.floor(Number(body.count) || 1));
      if (!Number.isInteger(itemId) || itemId <= 0 || !itemsById.has(itemId)) {
        throw new GameError('Unknown item.', 400);
      }

      const { loaded } = loadCharacter(db, accountId, id);
      loaded.character.warehouse ??= [];
      loaded.character.backpackContents ??= [];

      takeStack(loaded.character.warehouse, itemId, count);
      const moved = moveStackToBackpack(loaded.character, itemId, count);
      if (!moved.ok) {
        addItemStack(loaded.character.warehouse, itemId, count);
        throw new GameError(moved.reason, 400);
      }

      if (loaded.session) {
        loaded.session.character.warehouse = loaded.character.warehouse;
        loaded.session.character.backpackContents = loaded.character.backpackContents;
      }

      const now = Date.now();
      db.saveCharacter(
        loaded.row.id,
        JSON.stringify(loaded.character),
        loaded.session ? JSON.stringify(loaded.session) : null,
        now,
      );

      return reply.send({ character: describeCharacter(loaded, db) });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
