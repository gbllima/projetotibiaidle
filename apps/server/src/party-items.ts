import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { itemsById } from '@tibia-idle/data';
import { addItemStack, backpackCapacity, isConsumableItem, removeWorn, wearItem, type CharacterState, type EquipSlot } from '@tibia-idle/sim';
import { accountFromHeader, AuthError } from './auth.js';
import type { Database } from './db.js';
import { describeCharacter, loadCharacter, type LoadedCharacter } from './game.js';
import { GameError } from './settle.js';

type LootContainerTarget = 'pouch' | 'backpack' | 'supply' | 'warehouse';
type LootHistoryEntry = {
  at: number;
  kind: 'auto-sell' | 'route';
  itemId: number;
  count: number;
  gold?: number;
  target?: LootContainerTarget;
};

type LootPrefsCharacter = CharacterState & {
  lootIgnoredItemIds?: number[];
  lootProtectedItemIds?: number[];
  lootAutoSell?: boolean;
  lootAutoSellPercent?: number;
  lootSort?: boolean;
  lootContainerByItem?: Record<string, LootContainerTarget>;
  lootHistory?: LootHistoryEntry[];
};

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

function normalizedIds(raw: unknown): number[] {
  return [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function prefs(character: CharacterState) {
  const state = character as LootPrefsCharacter;
  return {
    ignoredItemIds: normalizedIds(state.lootIgnoredItemIds),
    protectedItemIds: normalizedIds(state.lootProtectedItemIds),
    autoSell: Boolean(state.lootAutoSell),
    autoSellPercent: Math.max(10, Math.min(100, Math.floor(Number(state.lootAutoSellPercent) || 90))),
    sort: Boolean(state.lootSort),
    containers: { ...(state.lootContainerByItem ?? {}) },
    history: Array.isArray(state.lootHistory) ? state.lootHistory.slice(-100) : [],
  };
}

function applyPrefs(character: CharacterState, next: ReturnType<typeof prefs>): void {
  const state = character as LootPrefsCharacter;
  state.lootIgnoredItemIds = normalizedIds(next.ignoredItemIds);
  state.lootProtectedItemIds = normalizedIds(next.protectedItemIds);
  state.lootAutoSell = Boolean(next.autoSell);
  state.lootAutoSellPercent = Math.max(10, Math.min(100, Math.floor(next.autoSellPercent || 90)));
  state.lootSort = Boolean(next.sort);
  state.lootContainerByItem = { ...next.containers };
  state.lootHistory = next.history.slice(-100);
}

function syncPrefsToSession(loaded: LoadedCharacter): void {
  if (!loaded.session) return;
  applyPrefs(loaded.session.character, prefs(loaded.character));
  loaded.session.character.policy.lootMinValue = 0;
}

function addHistory(character: CharacterState, entry: LootHistoryEntry): void {
  const state = character as LootPrefsCharacter;
  const history = Array.isArray(state.lootHistory) ? state.lootHistory : [];
  history.push(entry);
  state.lootHistory = history.slice(-100);
}

function pouchDistinctStacks(loaded: LoadedCharacter): number {
  if (!loaded.session) return 0;
  return Object.values(loaded.session.totals.lootByItem ?? {}).filter((count) => count > 0).length;
}

function tryRoute(sessionCharacter: CharacterState, itemId: number, count: number, target: LootContainerTarget): boolean {
  if (target === 'pouch') return false;
  if (target === 'warehouse') {
    sessionCharacter.warehouse ??= [];
    addItemStack(sessionCharacter.warehouse, itemId, count);
    return true;
  }
  if (target === 'backpack') {
    sessionCharacter.backpackContents ??= [];
    const bag = sessionCharacter.backpackContents;
    if (!bag.some((entry) => entry.itemId === itemId) && bag.length >= backpackCapacity(sessionCharacter)) return false;
    addItemStack(bag, itemId, count);
    return true;
  }
  const item = itemsById.get(itemId);
  if (!item || !isConsumableItem(item)) return false;
  sessionCharacter.supplies ??= [];
  const supplies = sessionCharacter.supplies;
  const cap = Math.max(1, sessionCharacter.supplySlots ?? 20);
  if (!supplies.some((entry) => entry.itemId === itemId) && supplies.filter((entry) => entry.count > 0).length >= cap) return false;
  addItemStack(supplies, itemId, count);
  return true;
}

export function sweepIgnoredLoot(db: Database): void {
  const now = Date.now();
  for (const row of db.allCharacters()) {
    if (!row.session) continue;
    try {
      const storedCharacter = JSON.parse(row.state) as CharacterState;
      const currentPrefs = prefs(storedCharacter);
      const ignored = new Set(currentPrefs.ignoredItemIds);
      const protectedIds = new Set(currentPrefs.protectedItemIds);
      const session = JSON.parse(row.session) as any;
      const lootByItem = session?.totals?.lootByItem as Record<number, number> | undefined;
      if (!lootByItem || !session.character) continue;
      applyPrefs(session.character, currentPrefs);
      session.character.policy.lootMinValue = 0;
      let changed = false;
      let stateChanged = false;

      for (const [rawId, rawCount] of Object.entries(lootByItem)) {
        const itemId = Number(rawId);
        const count = Number(rawCount) || 0;
        if (count <= 0) continue;
        if (ignored.has(itemId)) {
          delete lootByItem[itemId];
          changed = true;
          continue;
        }

        const target = currentPrefs.containers[String(itemId)] ?? 'pouch';
        if (target !== 'pouch' && tryRoute(session.character, itemId, count, target)) {
          delete lootByItem[itemId];
          const entry: LootHistoryEntry = { at: now, kind: 'route', itemId, count, target };
          addHistory(session.character, entry);
          addHistory(storedCharacter, entry);
          changed = true;
          stateChanged = true;
          continue;
        }

        if (currentPrefs.autoSell && !protectedIds.has(itemId)) {
          const unit = Number(itemsById.get(itemId)?.sellPrice ?? 0);
          if (unit > 0) {
            const gold = Math.floor(unit * count * currentPrefs.autoSellPercent / 100);
            session.character.gold += gold;
            delete lootByItem[itemId];
            const entry: LootHistoryEntry = { at: now, kind: 'auto-sell', itemId, count, gold };
            addHistory(session.character, entry);
            addHistory(storedCharacter, entry);
            changed = true;
            stateChanged = true;
          }
        }
      }

      if (!changed && !stateChanged) continue;
      db.saveCharacter(row.id, stateChanged ? JSON.stringify(storedCharacter) : row.state, JSON.stringify(session), now);
    } catch {
      // A malformed legacy row should never stop the sweep for everyone else.
    }
  }
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

  app.get('/api/characters/:id/loot-preferences', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const { loaded } = loadCharacter(db, accountId, id);
      return reply.send(prefs(loaded.character));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/loot-preferences', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { loaded } = loadCharacter(db, accountId, id);
      const next = prefs(loaded.character);

      if (typeof body.autoSell === 'boolean') next.autoSell = body.autoSell;
      if (body.autoSellPercent !== undefined) next.autoSellPercent = Math.max(10, Math.min(100, Math.floor(Number(body.autoSellPercent) || 90)));
      if (typeof body.sort === 'boolean') next.sort = body.sort;

      const itemId = Number(body.itemId);
      if (Number.isInteger(itemId) && itemId > 0) {
        if (typeof body.ignored === 'boolean') {
          const set = new Set(next.ignoredItemIds);
          if (body.ignored) set.add(itemId); else set.delete(itemId);
          next.ignoredItemIds = [...set];
        }
        if (typeof body.protected === 'boolean') {
          const set = new Set(next.protectedItemIds);
          if (body.protected) set.add(itemId); else set.delete(itemId);
          next.protectedItemIds = [...set];
        }
        if (body.container !== undefined) {
          const target = String(body.container);
          if (target === 'pouch') delete next.containers[String(itemId)];
          else if (target === 'backpack' || target === 'supply' || target === 'warehouse') next.containers[String(itemId)] = target;
          else throw new GameError('Container inválido.', 400);
        }
      }

      applyPrefs(loaded.character, next);
      loaded.character.policy.lootMinValue = 0;
      syncPrefsToSession(loaded);
      if (next.ignoredItemIds.includes(itemId) && loaded.session) delete loaded.session.totals.lootByItem[itemId];
      persist(db, loaded);
      return reply.send({ ...prefs(loaded.character), character: describeCharacter(loaded, db) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/backpack-to-loot', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { itemId?: unknown; count?: unknown };
      const itemId = Number(body.itemId);
      const count = Math.max(1, Math.floor(Number(body.count) || 1));
      const { loaded } = loadCharacter(db, accountId, id);
      if (!loaded.session || loaded.session.status !== 'active') throw new GameError('Entre em uma hunt para usar o Loot Pouch.', 409);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.', 400);
      if (prefs(loaded.character).ignoredItemIds.includes(itemId)) throw new GameError('Este item está marcado como não coletar.', 409);

      loaded.character.backpackContents ??= [];
      const alreadyInPouch = (loaded.session.totals.lootByItem[itemId] ?? 0) > 0;
      const cap = loaded.character.lootSlots ?? 8;
      if (!alreadyInPouch && pouchDistinctStacks(loaded) >= cap) throw new GameError('Loot Pouch cheio.', 409);

      takeStack(loaded.character.backpackContents, itemId, count);
      loaded.session.totals.lootByItem[itemId] = (loaded.session.totals.lootByItem[itemId] ?? 0) + count;
      loaded.session.character.backpackContents = loaded.character.backpackContents;
      syncPrefsToSession(loaded);
      persist(db, loaded);
      return reply.send({ character: describeCharacter(loaded, db), ...prefs(loaded.character) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/characters/:id/loot-ignore', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { itemId?: unknown; ignored?: unknown };
      const itemId = Number(body.itemId);
      const ignored = body.ignored !== false;
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.', 400);
      const { loaded } = loadCharacter(db, accountId, id);
      const next = prefs(loaded.character);
      const set = new Set(next.ignoredItemIds);
      if (ignored) set.add(itemId); else set.delete(itemId);
      next.ignoredItemIds = [...set];
      applyPrefs(loaded.character, next);
      syncPrefsToSession(loaded);
      if (ignored && loaded.session) delete loaded.session.totals.lootByItem[itemId];
      persist(db, loaded);
      return reply.send({ character: describeCharacter(loaded, db), ...prefs(loaded.character) });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
