import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  TICK_MS,
  addManaSpent,
  deriveStats,
  describeSession,
  isBossHunt,
  type CharacterState,
  type HuntPolicy,
  type HuntSession,
  type SimEvent,
} from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';
import { parsePartyHealSettings } from './party-healing.js';
import { GameError } from './settle.js';

const FRIEND_REQUEST_TTL_MS = 15 * 60_000;
const HEAL_FRIEND_LEVEL = 18;
const HEAL_FRIEND_MANA = 120;
const HEAL_FRIEND_COOLDOWN_MS = 1000;
const HEAL_FRIEND_COOLDOWN_TICKS = Math.max(1, Math.round(HEAL_FRIEND_COOLDOWN_MS / TICK_MS));

type BaseVocation = 1 | 2 | 3 | 4 | 9;

interface FriendRequest {
  fromId: number;
  toId: number;
  createdAt: number;
}

interface LiveMember {
  row: CharacterRow;
  session: HuntSession;
}

function friendsKey(accountId: number): string { return `friends:${accountId}`; }
function friendRequestsKey(accountId: number): string { return `friend-requests:${accountId}`; }
function multiplayerMemberKey(characterId: number): string { return `mp-member:${characterId}`; }
function multiplayerPartyKey(leaderId: number): string { return `mp-party:${leaderId}`; }
function liveHealKey(characterId: number): string { return `mp-live-heal:${characterId}`; }

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  } catch {
    return [];
  }
}

function stateFromRow(row: CharacterRow): CharacterState {
  if (row.session) {
    try { return (JSON.parse(row.session) as HuntSession).character; } catch { /* fall through */ }
  }
  return JSON.parse(row.state) as CharacterState;
}

function requireAccount(db: Database, request: FastifyRequest): number {
  const auth = request.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const accountId = token ? db.accountIdForToken(token) : null;
  if (accountId === null) throw new GameError('Unauthorized.', 401);
  return accountId;
}

function requireOwnedCharacter(db: Database, accountId: number, characterId: number): CharacterRow {
  const row = db.findCharacter(characterId);
  if (!row || row.accountId !== accountId) throw new GameError('No such character.', 404);
  return row;
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof GameError) return reply.status(error.status).send({ error: error.message });
  console.error('social live', error);
  return reply.status(500).send({ error: 'Algo deu errado.' });
}

function readFriendRequests(db: Database, accountId: number, now = Date.now()): FriendRequest[] {
  const raw = db.getWorld(friendRequestsKey(accountId));
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const requests = value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const source = entry as Partial<FriendRequest>;
      const request = {
        fromId: Number(source.fromId),
        toId: Number(source.toId),
        createdAt: Number(source.createdAt),
      };
      if (!Number.isInteger(request.fromId) || !Number.isInteger(request.toId) || !Number.isFinite(request.createdAt)) return [];
      if (now - request.createdAt > FRIEND_REQUEST_TTL_MS) return [];
      if (!db.findCharacter(request.fromId) || !db.findCharacter(request.toId)) return [];
      return [request];
    });
    if (requests.length !== value.length) db.setWorld(friendRequestsKey(accountId), JSON.stringify(requests));
    return requests;
  } catch {
    db.setWorld(friendRequestsKey(accountId), '[]');
    return [];
  }
}

function writeFriendRequests(db: Database, accountId: number, requests: FriendRequest[]): void {
  db.setWorld(friendRequestsKey(accountId), JSON.stringify(requests));
}

function friendIds(db: Database, accountId: number): number[] {
  return parseIds(db.getWorld(friendsKey(accountId)));
}

function accountHasFriendAccount(db: Database, accountId: number, friendAccountId: number): boolean {
  return friendIds(db, accountId).some((id) => db.findCharacter(id)?.accountId === friendAccountId);
}

function addFriendForAccount(db: Database, accountId: number, friendCharacterId: number): void {
  const ids = friendIds(db, accountId);
  const friend = db.findCharacter(friendCharacterId);
  if (!friend) return;
  const withoutSameAccount = ids.filter((id) => db.findCharacter(id)?.accountId !== friend.accountId);
  db.setWorld(friendsKey(accountId), JSON.stringify([...withoutSameAccount, friendCharacterId]));
}

function sendFriendRequest(db: Database, accountId: number, characterId: number, targetName: string): void {
  const owner = requireOwnedCharacter(db, accountId, characterId);
  const target = db.findCharacterByName(targetName.trim());
  if (!target) throw new GameError('Personagem não encontrado.', 404);
  if (target.accountId === owner.accountId) throw new GameError('Adicione como amigo um jogador de outra conta.', 409);
  if (accountHasFriendAccount(db, owner.accountId, target.accountId)) throw new GameError('Esse jogador já está na sua lista de amigos.', 409);

  const requests = readFriendRequests(db, target.accountId)
    .filter((request) => db.findCharacter(request.fromId)?.accountId !== owner.accountId);
  requests.push({ fromId: owner.id, toId: target.id, createdAt: Date.now() });
  writeFriendRequests(db, target.accountId, requests);
}

function answerFriendRequest(db: Database, accountId: number, characterId: number, fromId: number, accept: boolean): void {
  requireOwnedCharacter(db, accountId, characterId);
  const requests = readFriendRequests(db, accountId);
  const request = requests.find((entry) => entry.fromId === fromId);
  if (!request) throw new GameError('Pedido de amizade não encontrado ou expirado.', 404);
  const sender = db.findCharacter(request.fromId);
  const target = db.findCharacter(request.toId);
  if (!sender || !target || target.accountId !== accountId) throw new GameError('Pedido de amizade inválido.', 409);

  writeFriendRequests(db, accountId, requests.filter((entry) => entry.fromId !== fromId));
  if (!accept) return;

  addFriendForAccount(db, accountId, sender.id);
  addFriendForAccount(db, sender.accountId, target.id);
}

function removeMutualFriend(db: Database, accountId: number, characterId: number, friendId: number): void {
  requireOwnedCharacter(db, accountId, characterId);
  const friend = db.findCharacter(friendId);
  if (!friend) {
    db.setWorld(friendsKey(accountId), JSON.stringify(friendIds(db, accountId).filter((id) => id !== friendId)));
    return;
  }
  const ownAccount = accountId;
  const friendAccount = friend.accountId;
  db.setWorld(friendsKey(ownAccount), JSON.stringify(friendIds(db, ownAccount).filter((id) => db.findCharacter(id)?.accountId !== friendAccount)));
  db.setWorld(friendsKey(friendAccount), JSON.stringify(friendIds(db, friendAccount).filter((id) => db.findCharacter(id)?.accountId !== ownAccount)));
}

export function multiplayerPartyMemberIds(db: Database, characterId: number): number[] {
  const leaderId = Number(db.getWorld(multiplayerMemberKey(characterId)) ?? 0);
  if (!Number.isInteger(leaderId) || leaderId <= 0) return [];
  const ids = parseIds(db.getWorld(multiplayerPartyKey(leaderId)));
  if (ids.length < 2 || ids[0] !== leaderId || !ids.includes(characterId)) return [];
  return ids.filter((id) => Boolean(db.findCharacter(id)));
}

function multiplayerMemberView(db: Database, memberId: number, selfId: number) {
  const row = db.findCharacter(memberId);
  if (!row) return null;
  const state = stateFromRow(row);
  const stats = deriveStats(state);
  let active = false;
  if (row.session) {
    try { active = (JSON.parse(row.session) as HuntSession).status === 'active'; } catch { active = false; }
  }
  return {
    id: row.id,
    name: state.name,
    level: state.level,
    experience: state.experience,
    health: Math.max(0, Math.round(state.health)),
    maxHealth: stats.maxHealth,
    mana: Math.max(0, Math.round(state.mana)),
    maxMana: stats.maxMana,
    vocationId: state.vocationId,
    appearance: state.appearance,
    active,
    self: row.id === selfId,
    multiplayer: true,
  };
}

export function decorateMultiplayerCharacter<T extends { caveParty?: unknown[] }>(db: Database, characterId: number, character: T): T {
  const ids = multiplayerPartyMemberIds(db, characterId);
  if (ids.length < 2) return character;
  const members = ids.flatMap((id) => {
    const member = multiplayerMemberView(db, id, characterId);
    return member ? [member] : [];
  });
  const active = liveMembers(db, characterId).filter((entry) => entry.session.character.health > 0);
  const huntId = active.find((entry) => entry.row.id === characterId)?.session.huntId;
  const group = active.filter((entry) => entry.session.huntId === huntId);
  const first = group[0];
  // All viewers use the same party kill total, never their own predicted wave.
  const shared = first ? describeSession({
    ...first.session,
    totals: { ...first.session.totals, kills: group.reduce((sum, entry) => sum + entry.session.totals.kills, 0) },
  }) : null;
  const alive = group.reduce((sum, entry) => sum + entry.session.active.length, 0);
  const partyWave = shared ? {
    huntId, wave: shared.wave, wavesTotal: shared.wavesTotal,
    wavesCleared: shared.wavesCleared, bossWave: shared.bossWave,
    packAlive: alive, packSize: Math.max(shared.packSize, alive),
  } : null;
  return { ...character, caveParty: members, partyWave } as T;
}

function baseVocation(vocationId: number): BaseVocation {
  if (vocationId === 5) return 1;
  if (vocationId === 6) return 2;
  if (vocationId === 7) return 3;
  if (vocationId === 8) return 4;
  if (vocationId === 10) return 9;
  return ([1, 2, 3, 4, 9] as number[]).includes(vocationId) ? vocationId as BaseVocation : 1;
}

function combatPolicy(session: HuntSession): HuntPolicy {
  return isBossHunt(session.huntId)
    ? session.character.helperProfiles?.boss ?? session.character.policy
    : session.character.policy;
}

function liveMembers(db: Database, characterId: number): LiveMember[] {
  const ids = multiplayerPartyMemberIds(db, characterId);
  if (ids.length < 2) return [];
  return ids.flatMap((id) => {
    const row = db.findCharacter(id);
    if (!row?.session) return [];
    try {
      const session = JSON.parse(row.session) as HuntSession;
      return session.status === 'active' ? [{ row, session }] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Lightweight real-time Heal Friend bridge for multiplayer parties. The normal
 * single-account party settlement already handles ally healing. Multiplayer
 * members have independent accounts/sessions, so this pass connects those live
 * sessions while both players are actually online in the shared hunt.
 */
export function applyMultiplayerLiveHealing(db: Database, characterId: number, now = Date.now()): SimEvent[] {
  const members = liveMembers(db, characterId);
  if (members.length < 2) return [];
  const huntId = members.find((entry) => entry.row.id === characterId)?.session.huntId;
  if (!huntId) return [];
  const group = members.filter((entry) => entry.session.huntId === huntId);
  if (group.length < 2) return [];

  const touched = new Set<number>();
  const events: SimEvent[] = [];

  for (const healer of group) {
    const character = healer.session.character;
    if (baseVocation(character.vocationId) !== 2 || character.level < HEAL_FRIEND_LEVEL) continue;
    if (character.mana < HEAL_FRIEND_MANA || (healer.session.healCooldownTicks ?? 0) > 0) continue;
    const lastCast = Number(db.getWorld(liveHealKey(healer.row.id)) ?? 0);
    if (Number.isFinite(lastCast) && lastCast > 0 && now - lastCast < HEAL_FRIEND_COOLDOWN_MS) continue;

    const policy = combatPolicy(healer.session);
    const settings = parsePartyHealSettings(policy);
    if (!settings.enabled) continue;

    if (settings.selfFirst) {
      const ownStats = deriveStats(character);
      const ownTrigger = Math.max(policy.healSpellAt ?? 0.7, policy.healthPotionAt ?? 0.6);
      if (character.health / Math.max(1, ownStats.maxHealth) < ownTrigger) continue;
    }

    const candidates = group
      .filter((target) => target.row.id !== healer.row.id && target.session.character.health > 0)
      .map((target) => {
        const targetCharacter = target.session.character;
        const vocation = baseVocation(targetCharacter.vocationId);
        const stats = deriveStats(targetCharacter);
        const healthRatio = targetCharacter.health / Math.max(1, stats.maxHealth);
        return {
          target,
          vocation,
          stats,
          healthRatio,
          priority: settings.priority[vocation],
          threshold: settings.threshold[vocation],
        };
      })
      .filter((candidate) => candidate.healthRatio < candidate.threshold)
      .sort((left, right) => left.priority - right.priority || left.healthRatio - right.healthRatio || left.target.row.id - right.target.row.id);

    const chosen = candidates[0];
    if (!chosen) continue;
    const amount = Math.min(
      Math.max(1, Math.round(80 + character.level * 1.5 + character.magicLevel * 10)),
      Math.max(0, chosen.stats.maxHealth - chosen.target.session.character.health),
    );
    if (amount <= 0) continue;

    character.mana -= HEAL_FRIEND_MANA;
    addManaSpent(character, HEAL_FRIEND_MANA, 1);
    chosen.target.session.character.health += amount;
    healer.session.totals.healingDone += amount;
    healer.session.healCooldownTicks = HEAL_FRIEND_COOLDOWN_TICKS;
    db.setWorld(liveHealKey(healer.row.id), String(now));
    touched.add(healer.row.id);
    touched.add(chosen.target.row.id);
    events.push({
      tick: healer.session.tick,
      type: 'heal',
      actorId: healer.row.id,
      amount,
      words: 'exura sio',
    });
  }

  for (const member of group) {
    if (!touched.has(member.row.id)) continue;
    db.saveCharacter(member.row.id, member.row.state, JSON.stringify(member.session), member.row.settledAt);
  }
  return events;
}

function inbox(db: Database, accountId: number) {
  return {
    friendRequests: readFriendRequests(db, accountId).flatMap((request) => {
      const sender = db.findCharacter(request.fromId);
      if (!sender) return [];
      const state = stateFromRow(sender);
      return [{
        fromId: sender.id,
        fromName: state.name,
        level: state.level,
        vocationId: state.vocationId,
        appearance: state.appearance,
        createdAt: request.createdAt,
      }];
    }),
  };
}

export function registerSocialLiveRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/social/:id/inbox', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      requireOwnedCharacter(db, accountId, id);
      return reply.send(inbox(db, accountId));
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/social/:id/friend-request', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { name?: unknown };
      const name = String(body.name ?? '').trim();
      if (!name) throw new GameError('Informe o nome do personagem.', 422);
      sendFriendRequest(db, accountId, id, name);
      return reply.send({ ok: true });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/social/:id/friend-request/accept', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { fromId?: unknown };
      answerFriendRequest(db, accountId, id, Number(body.fromId), true);
      return reply.send({ ok: true, inbox: inbox(db, accountId) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/social/:id/friend-request/decline', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { fromId?: unknown };
      answerFriendRequest(db, accountId, id, Number(body.fromId), false);
      return reply.send({ ok: true, inbox: inbox(db, accountId) });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/social/:id/friends/:friendId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; friendId: string };
      removeMutualFriend(db, accountId, Number(params.id), Number(params.friendId));
      return reply.send({ ok: true });
    } catch (error) { return fail(reply, error); }
  });
}
