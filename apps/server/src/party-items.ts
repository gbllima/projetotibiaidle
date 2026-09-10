import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addItemStack, backpackCapacity, removeWorn, wearItem, type EquipSlot } from '@tibia-idle/sim';
import { accountFromHeader, AuthError } from './auth.js';
import type { Database } from './db.js';
import { describeCharacter, loadCharacter, type LoadedCharacter } from './game.js';
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

function persist(db: Database, loaded: LoadedCharacter, now = Date.now()): void {
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
}

function takeStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || stack.count < count) throw new GameError('You do not have that item.', 400);
  stack.count -= count;
  if (stack.count <= 0) list.splice(list.indexOf(stack), 1);
}

function addToSharedInventory(owner: LoadedCharacter, itemId: number, count: number): void {
  owner.character.backpackContents ??= [];
  owner.character.warehouse ??= [];
  const bag = owner.character.backpackContents;
  const existing = bag.some((entry) => entry.itemId === itemId);
  if (existing || bag.length < backpackCapacity(owner.character)) addItemStack(bag, itemId, count);
  else addItemStack(owner.character.warehouse, itemId, count);
}

function drainMemberBackpack(owner: LoadedCharacter, member: LoadedCharacter): void {
  member.character.backpackContents ??= [];
  for (const stack of member.character.backpackContents.filter((entry) => entry.count > 0)) {
    addToSharedInventory(owner, stack.itemId, stack.count);
  }
  member.character.backpackContents = [];
}

function partyIdsFromOwner(owner: LoadedCharacter, db: Database): number[] {
  const view = describeCharacter(owner, db) as unknown as { partyMemberIds?: number[] };
  return view.partyMemberIds ?? [owner.row.id];
}

function mergedMemberView(owner: LoadedCharacter, member: LoadedCharacter, db: Database) {
  const ownerView = describeCharacter(owner, db) as any;
  const memberView = describeCharacter(member, db) as any;
  memberView.backpackContents = ownerView.backpackContents ?? [];
  memberView.backpackCapacity = ownerView.backpackCapacity ?? backpackCapacity(owner.character);
  return memberView;
}

export function registerPartyItemRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/characters/:id/party-items/:targetId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; targetId: string };
      const ownerId = Number(params.id);
      const targetId = Number(params.targetId);
      const { loaded: owner } = loadCharacter(db, accountId, ownerId);
      const ids = partyIdsFromOwner(owner, db);
      if (!ids.includes(targetId)) throw new GameError('O personagem não pertence a esta party.', 403);
      const { loaded: target } = targetId === ownerId ? { loaded: owner } : loadCharacter(db, accountId, targetId);
      return reply.send({ character: mergedMemberView(owner, target, db) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/party-items/:targetId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; targetId: string };
      const ownerId = Number(params.id);
      const targetId = Number(params.targetId);
      const body = (request.body ?? {}) as { type?: unknown; itemId?: unknown; slot?: unknown; count?: unknown; source?: unknown };
      const type = String(body.type ?? '');
      const { loaded: owner } = loadCharacter(db, accountId, ownerId);
      const ids = partyIdsFromOwner(owner, db);
      if (!ids.includes(targetId)) throw new GameError('O personagem não pertence a esta party.', 403);
      const { loaded: target } = targetId === ownerId ? { loaded: owner } : loadCharacter(db, accountId, targetId);

      owner.character.backpackContents ??= [];
      owner.character.warehouse ??= [];
      target.character.backpackContents ??= [];
      target.character.warehouse ??= [];

      if (type === 'equip') {
        const itemId = Number(body.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.', 400);
        takeStack(owner.character.backpackContents, itemId, 1);
        const worn = wearItem(target.character, itemId);
        if (!worn.ok) {
          addToSharedInventory(owner, itemId, 1);
          throw new GameError(worn.reason, 400);
        }
        if (target !== owner) drainMemberBackpack(owner, target);
      } else if (type === 'unequip') {
        const slot = String(body.slot ?? '') as EquipSlot;
        const removed = removeWorn(target.character, slot);
        if (!removed.ok) throw new GameError(removed.reason, 400);
        if (target !== owner) drainMemberBackpack(owner, target);
      } else if (type === 'destroy-item') {
        const itemId = Number(body.itemId);
        const count = Math.max(1, Math.floor(Number(body.count) || 1));
        const source = String(body.source ?? 'backpack');
        if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.', 400);
        if (source === 'backpack') {
          takeStack(owner.character.backpackContents, itemId, count);
        } else if (source === 'worn') {
          const slot = String(body.slot ?? '') as EquipSlot;
          const removed = removeWorn(target.character, slot);
          if (!removed.ok) throw new GameError(removed.reason, 400);
          const inBag = target.character.backpackContents.find((entry) => entry.itemId === removed.itemId);
          if (inBag) takeStack(target.character.backpackContents, removed.itemId, 1);
          else takeStack(target.character.warehouse, removed.itemId, 1);
          if (target !== owner) drainMemberBackpack(owner, target);
        } else {
          throw new GameError('Invalid item source.', 400);
        }
      } else {
        throw new GameError('Invalid party item action.', 400);
      }

      const now = Date.now();
      persist(db, owner, now);
      if (target !== owner) persist(db, target, now);
      return reply.send({ character: mergedMemberView(owner, target, db) });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
