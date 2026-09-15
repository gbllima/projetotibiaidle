import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  MULTIPLAYER_PARTY_BOOST_PREFIX, MULTIPLAYER_PARTY_XP_BONUS,
  type CharacterState, type HuntSession,
} from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';
import { listHunts, startHunt, stopHunt } from './game.js';
import { onlineCharacterIds } from './presence.js';
import { GameError } from './settle.js';

const PARTY_CAP = 5;
const INVITE_TTL_MS = 15 * 60_000;
const TRAINING_ACTIVITY_TTL_MS = 15_000;

interface SavedPersonalParty {
  ownerId: number;
  ids: number[];
}

interface PendingInvite {
  leaderId: number;
  createdAt: number;
}

function memberKey(characterId: number): string { return `mp-member:${characterId}`; }
function partyKey(leaderId: number): string { return `mp-party:${leaderId}`; }
function inviteKey(characterId: number): string { return `mp-invite:${characterId}`; }
function savedPartyKey(characterId: number): string { return `mp-saved-party:${characterId}`; }
function personalPartyKey(characterId: number): string { return `party:${characterId}`; }
function friendsKey(accountId: number): string { return `friends:${accountId}`; }
function activityKey(characterId: number): string { return `friend-activity:${characterId}`; }

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
  console.error('multiplayer party', error);
  return reply.status(500).send({ error: 'Algo deu errado.' });
}

function personalFormation(db: Database, accountId: number, characterId: number): SavedPersonalParty {
  for (const row of db.charactersForAccount(accountId)) {
    const ids = parseIds(db.getWorld(personalPartyKey(row.id)));
    if (ids.length > 1 && ids[0] === row.id && ids.includes(characterId)) return { ownerId: row.id, ids };
  }
  return { ownerId: characterId, ids: [characterId] };
}

function suspendPersonalParty(db: Database, row: CharacterRow): void {
  if (db.getWorld(savedPartyKey(row.id))) return;
  const saved = personalFormation(db, row.accountId, row.id);
  db.setWorld(savedPartyKey(row.id), JSON.stringify(saved));
  // The original formation is only suspended. We restore it exactly when the
  // character leaves multiplayer, so companions from either account never join.
  db.setWorld(personalPartyKey(saved.ownerId), JSON.stringify([saved.ownerId]));
}

function restorePersonalParty(db: Database, characterId: number): void {
  const raw = db.getWorld(savedPartyKey(characterId));
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as SavedPersonalParty;
    if (Number.isInteger(saved.ownerId) && Array.isArray(saved.ids) && saved.ids.length) {
      const owner = db.findCharacter(saved.ownerId);
      const member = db.findCharacter(characterId);
      // Restore only if this is still the same account. This prevents a stale
      // snapshot from ever attaching characters across accounts.
      if (owner && member && owner.accountId === member.accountId) {
        const ids = saved.ids.filter((id) => db.findCharacter(id)?.accountId === member.accountId);
        db.setWorld(personalPartyKey(saved.ownerId), JSON.stringify(ids.length ? ids : [saved.ownerId]));
      }
    }
  } catch {
    // Ignore malformed legacy snapshot and fall back to solo.
  }
  db.setWorld(savedPartyKey(characterId), '');
}

function leaderFor(db: Database, characterId: number): number | null {
  const leaderId = Number(db.getWorld(memberKey(characterId)) ?? 0);
  if (!Number.isInteger(leaderId) || leaderId <= 0) return null;
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  if (!ids.includes(characterId) || ids[0] !== leaderId) {
    db.setWorld(memberKey(characterId), '');
    return null;
  }
  return leaderId;
}

export function multiplayerPartyIds(db: Database, characterId: number): number[] {
  const leaderId = leaderFor(db, characterId);
  return leaderId ? parseIds(db.getWorld(partyKey(leaderId))) : [];
}

function activeCharacterForAccount(db: Database, accountId: number): number | null {
  for (const row of db.charactersForAccount(accountId)) {
    if (leaderFor(db, row.id)) return row.id;
  }
  return null;
}

function ensureUniqueAccounts(db: Database, ids: number[]): void {
  const seen = new Set<number>();
  for (const id of ids) {
    const row = db.findCharacter(id);
    if (!row) throw new GameError('Personagem da party não existe mais.', 409);
    if (seen.has(row.accountId)) throw new GameError('Apenas um personagem por conta pode entrar na party multiplayer.', 409);
    seen.add(row.accountId);
  }
}

function characterSummary(row: CharacterRow) {
  const state = stateFromRow(row);
  return {
    id: row.id,
    name: state.name,
    level: state.level,
    vocationId: state.vocationId,
    appearance: state.appearance,
  };
}

function pendingInvite(db: Database, characterId: number): PendingInvite | null {
  const raw = db.getWorld(inviteKey(characterId));
  if (!raw) return null;
  try {
    const invite = JSON.parse(raw) as PendingInvite;
    if (!Number.isInteger(invite.leaderId) || Date.now() - Number(invite.createdAt) > INVITE_TTL_MS || !db.findCharacter(invite.leaderId)) {
      db.setWorld(inviteKey(characterId), '');
      return null;
    }
    return invite;
  } catch {
    db.setWorld(inviteKey(characterId), '');
    return null;
  }
}

export function multiplayerPartyHuntGate(db: Database, characterId: number): { minLevel: number; allowedHuntIds: string[] } | null {
  const ids = multiplayerPartyIds(db, characterId);
  if (ids.length < 2) return null;
  const rows = ids.flatMap((id) => {
    const row = db.findCharacter(id);
    return row ? [row] : [];
  });
  if (rows.length !== ids.length) return null;

  const states = rows.map(stateFromRow);
  const minLevel = Math.min(...states.map((state) => state.level));
  let allowed: Set<string> | null = null;
  for (const state of states) {
    const unlocked = new Set(listHunts(state).filter((hunt) => hunt.unlocked).map((hunt) => hunt.id));
    allowed = allowed === null ? unlocked : new Set([...allowed].filter((huntId) => unlocked.has(huntId)));
  }
  return { minLevel, allowedHuntIds: [...(allowed ?? new Set<string>())] };
}

export function multiplayerPartyStatus(db: Database, characterId: number) {
  const leaderId = leaderFor(db, characterId);
  const ids = leaderId ? parseIds(db.getWorld(partyKey(leaderId))) : [];
  const members = ids.flatMap((id) => {
    const row = db.findCharacter(id);
    return row ? [characterSummary(row)] : [];
  });
  const invite = pendingInvite(db, characterId);
  const inviter = invite ? db.findCharacter(invite.leaderId) : null;
  return {
    active: ids.length > 1,
    leaderId: leaderId ?? undefined,
    isLeader: Boolean(leaderId && leaderId === characterId),
    maxMembers: PARTY_CAP,
    minLevel: members.length ? Math.min(...members.map((member) => member.level)) : undefined,
    xpBonusPercent: Math.round(MULTIPLAYER_PARTY_XP_BONUS * 100),
    members,
    invite: inviter ? { fromId: inviter.id, fromName: stateFromRow(inviter).name, createdAt: invite!.createdAt } : undefined,
  };
}

function invite(db: Database, accountId: number, characterId: number, targetName: string): void {
  const inviter = requireOwnedCharacter(db, accountId, characterId);
  const target = db.findCharacterByName(targetName.trim());
  if (!target) throw new GameError('Personagem não encontrado.', 404);
  if (target.id === inviter.id || target.accountId === inviter.accountId) {
    throw new GameError('Use Single Player para personagens da sua própria conta.', 409);
  }
  const currentLeader = leaderFor(db, inviter.id);
  if (currentLeader && currentLeader !== inviter.id) throw new GameError('Somente o líder pode convidar jogadores.', 403);
  const currentIds = currentLeader ? parseIds(db.getWorld(partyKey(currentLeader))) : [inviter.id];
  if (currentIds.length >= PARTY_CAP) throw new GameError('A party multiplayer está cheia.', 409);
  if (leaderFor(db, target.id)) throw new GameError('Esse personagem já está em uma party multiplayer.', 409);
  const activeTarget = activeCharacterForAccount(db, target.accountId);
  if (activeTarget && activeTarget !== target.id) throw new GameError('Essa conta já está usando outro personagem em uma party multiplayer.', 409);
  ensureUniqueAccounts(db, [...currentIds, target.id]);
  db.setWorld(inviteKey(target.id), JSON.stringify({ leaderId: currentLeader ?? inviter.id, createdAt: Date.now() } satisfies PendingInvite));
}

function accept(db: Database, accountId: number, characterId: number): void {
  const target = requireOwnedCharacter(db, accountId, characterId);
  if (leaderFor(db, target.id)) throw new GameError('Você já está em uma party multiplayer.', 409);
  const invite = pendingInvite(db, target.id);
  if (!invite) throw new GameError('Nenhum convite multiplayer pendente.', 404);
  const leader = db.findCharacter(invite.leaderId);
  if (!leader) throw new GameError('O líder não está mais disponível.', 404);
  if (leader.accountId === target.accountId) throw new GameError('Party multiplayer exige contas diferentes.', 409);
  const leaderOfLeader = leaderFor(db, leader.id);
  if (leaderOfLeader && leaderOfLeader !== leader.id) throw new GameError('O convite não é mais válido.', 409);
  const ids = leaderOfLeader ? parseIds(db.getWorld(partyKey(leader.id))) : [leader.id];
  if (ids.length >= PARTY_CAP) throw new GameError('A party multiplayer está cheia.', 409);
  if (activeCharacterForAccount(db, target.accountId)) throw new GameError('Sua conta já está em outra party multiplayer.', 409);
  ensureUniqueAccounts(db, [...ids, target.id]);

  suspendPersonalParty(db, leader);
  suspendPersonalParty(db, target);
  const next = [...ids, target.id];
  db.setWorld(partyKey(leader.id), JSON.stringify(next));
  for (const id of next) db.setWorld(memberKey(id), String(leader.id));
  db.setWorld(inviteKey(target.id), '');
}

function boostedMonsterWithMultiplayerBonus(value?: string): string {
  if (value?.startsWith(MULTIPLAYER_PARTY_BOOST_PREFIX)) return value;
  return `${MULTIPLAYER_PARTY_BOOST_PREFIX}${value ?? ''}`;
}

function boostedMonsterWithoutMultiplayerBonus(value?: string): string | undefined {
  if (!value?.startsWith(MULTIPLAYER_PARTY_BOOST_PREFIX)) return value;
  const original = value.slice(MULTIPLAYER_PARTY_BOOST_PREFIX.length);
  return original || undefined;
}

function setMultiplayerXpBonus(db: Database, characterId: number, enabled: boolean): void {
  const row = db.findCharacter(characterId);
  if (!row?.session) return;
  try {
    const session = JSON.parse(row.session) as HuntSession;
    const next = enabled
      ? boostedMonsterWithMultiplayerBonus(session.boostedMonsterId)
      : boostedMonsterWithoutMultiplayerBonus(session.boostedMonsterId);
    if (next === session.boostedMonsterId) return;
    session.boostedMonsterId = next;
    db.saveCharacter(row.id, row.state, JSON.stringify(session), row.settledAt);
  } catch {
    // A malformed session is handled by the normal character loader.
  }
}

function dissolve(db: Database, leaderId: number): void {
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  for (const id of ids) {
    setMultiplayerXpBonus(db, id, false);
    db.setWorld(memberKey(id), '');
    restorePersonalParty(db, id);
  }
  db.setWorld(partyKey(leaderId), '');
}

function leave(db: Database, accountId: number, characterId: number): void {
  requireOwnedCharacter(db, accountId, characterId);
  const leaderId = leaderFor(db, characterId);
  if (!leaderId) throw new GameError('Você não está em uma party multiplayer.', 409);
  if (leaderId === characterId) {
    dissolve(db, leaderId);
    return;
  }
  const ids = parseIds(db.getWorld(partyKey(leaderId))).filter((id) => id !== characterId);
  setMultiplayerXpBonus(db, characterId, false);
  db.setWorld(memberKey(characterId), '');
  restorePersonalParty(db, characterId);
  if (ids.length <= 1) {
    dissolve(db, leaderId);
    return;
  }
  db.setWorld(partyKey(leaderId), JSON.stringify(ids));
}

function kick(db: Database, accountId: number, leaderId: number, memberId: number): void {
  requireOwnedCharacter(db, accountId, leaderId);
  if (leaderFor(db, leaderId) !== leaderId) throw new GameError('Somente o líder pode remover jogadores.', 403);
  if (memberId === leaderId) throw new GameError('Use sair para encerrar a party.', 409);
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  if (!ids.includes(memberId)) throw new GameError('Esse personagem não está na sua party.', 404);
  setMultiplayerXpBonus(db, memberId, false);
  db.setWorld(memberKey(memberId), '');
  restorePersonalParty(db, memberId);
  const next = ids.filter((id) => id !== memberId);
  if (next.length <= 1) dissolve(db, leaderId);
  else db.setWorld(partyKey(leaderId), JSON.stringify(next));
}

function startSharedHunt(db: Database, accountId: number, characterId: number, huntId: string, hours?: number): number[] {
  requireOwnedCharacter(db, accountId, characterId);
  const leaderId = leaderFor(db, characterId);
  if (!leaderId || leaderId !== characterId) throw new GameError('Somente o líder pode iniciar a hunt multiplayer.', 403);
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  const gate = multiplayerPartyHuntGate(db, characterId);
  if (!gate || !gate.allowedHuntIds.includes(huntId)) {
    throw new GameError(`A party só pode acessar hunts liberadas para todos. Menor level da party: ${gate?.minLevel ?? '?'}.`, 422);
  }

  const started: number[] = [];
  const marked: number[] = [];
  try {
    for (const id of ids) {
      const row = db.findCharacter(id);
      if (!row) throw new GameError('Um membro da party não existe mais.', 409);
      let alreadyThere = false;
      if (row.session) {
        try {
          const session = JSON.parse(row.session) as HuntSession;
          alreadyThere = session.status === 'active' && session.huntId === huntId;
        } catch { /* startHunt will repair/switch */ }
      }
      if (!alreadyThere) {
        const loaded = startHunt(db, row.accountId, id, huntId, Date.now(), hours);
        started.push(id);
        if (!loaded.session || loaded.session.status !== 'active' || loaded.session.huntId !== huntId) {
          throw new GameError('Não há vagas suficientes para colocar toda a party na mesma hunt.', 409);
        }
      }
      setMultiplayerXpBonus(db, id, true);
      marked.push(id);
    }
    return ids;
  } catch (error) {
    for (const id of marked) setMultiplayerXpBonus(db, id, false);
    // Avoid leaving half the multiplayer party in a cave when one member cannot
    // enter (level, supplies, capacity, queue, etc.).
    for (const id of started) {
      const row = db.findCharacter(id);
      if (!row) continue;
      try { stopHunt(db, row.accountId, id, Date.now()); } catch { /* best-effort rollback */ }
    }
    throw error;
  }
}

function stopSharedHunt(db: Database, accountId: number, characterId: number): number[] {
  requireOwnedCharacter(db, accountId, characterId);
  const leaderId = leaderFor(db, characterId);
  if (!leaderId || leaderId !== characterId) throw new GameError('Somente o líder pode encerrar a hunt multiplayer para todos.', 403);
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  for (const id of ids) {
    const row = db.findCharacter(id);
    if (!row) continue;
    try { stopHunt(db, row.accountId, id, Date.now()); } catch (error) {
      if (!(error instanceof GameError) || error.status !== 409) throw error;
    }
  }
  return ids;
}

function friendIds(db: Database, accountId: number): number[] {
  return parseIds(db.getWorld(friendsKey(accountId)));
}

function friendActivity(db: Database, row: CharacterRow, online: boolean, now: number): 'Hunt' | 'Treino' | 'Cidade' | 'Offline' {
  if (!online) return 'Offline';
  if (row.session || db.queuedHunt(row.id)) return 'Hunt';
  const lastTraining = Number(db.getWorld(activityKey(row.id)) ?? 0);
  if (Number.isFinite(lastTraining) && lastTraining > 0 && now - lastTraining <= TRAINING_ACTIVITY_TTL_MS) return 'Treino';
  return 'Cidade';
}

function friendsStatus(db: Database, accountId: number) {
  const online = new Set(onlineCharacterIds());
  const now = Date.now();
  return friendIds(db, accountId).flatMap((id) => {
    const row = db.findCharacter(id);
    if (!row) return [];
    const state = stateFromRow(row);
    const isOnline = online.has(id);
    return [{
      id,
      name: state.name,
      level: state.level,
      vocationId: state.vocationId,
      appearance: state.appearance,
      online: isOnline,
      activity: friendActivity(db, row, isOnline, now),
    }];
  });
}

function addFriend(db: Database, accountId: number, characterId: number, targetName: string): void {
  const owner = requireOwnedCharacter(db, accountId, characterId);
  const target = db.findCharacterByName(targetName.trim());
  if (!target) throw new GameError('Personagem não encontrado.', 404);
  if (target.id === owner.id || target.accountId === owner.accountId) {
    throw new GameError('Adicione como amigo um jogador de outra conta.', 409);
  }
  const ids = friendIds(db, accountId);
  if (!ids.includes(target.id)) db.setWorld(friendsKey(accountId), JSON.stringify([...ids, target.id]));
}

function removeFriend(db: Database, accountId: number, characterId: number, friendId: number): void {
  requireOwnedCharacter(db, accountId, characterId);
  db.setWorld(friendsKey(accountId), JSON.stringify(friendIds(db, accountId).filter((id) => id !== friendId)));
}

export function registerMultiplayerPartyRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/multiplayer-party/:id', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      requireOwnedCharacter(db, accountId, id);
      return reply.send(multiplayerPartyStatus(db, id));
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/multiplayer-party/:id/invite', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { name?: unknown };
      const name = String(body.name ?? '').trim();
      if (!name) throw new GameError('Informe o nome do personagem.', 422);
      invite(db, accountId, id, name);
      return reply.send({ ok: true, status: multiplayerPartyStatus(db, id) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/multiplayer-party/:id/accept', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      accept(db, accountId, id);
      return reply.send({ ok: true, status: multiplayerPartyStatus(db, id) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/multiplayer-party/:id/decline', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      requireOwnedCharacter(db, accountId, id);
      db.setWorld(inviteKey(id), '');
      return reply.send({ ok: true, status: multiplayerPartyStatus(db, id) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/multiplayer-party/:id/leave', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      leave(db, accountId, id);
      return reply.send({ ok: true, status: multiplayerPartyStatus(db, id) });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/multiplayer-party/:id/members/:memberId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; memberId: string };
      const id = Number(params.id); const memberId = Number(params.memberId);
      kick(db, accountId, id, memberId);
      return reply.send({ ok: true, status: multiplayerPartyStatus(db, id) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/multiplayer-party/:id/hunt', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { huntId?: unknown; hours?: unknown };
      const huntId = String(body.huntId ?? '').trim();
      if (!huntId) throw new GameError('Missing "huntId".', 422);
      const rawHours = Number(body.hours);
      const hours = Number.isFinite(rawHours) ? Math.min(24, Math.max(1, Math.floor(rawHours))) : undefined;
      const memberIds = startSharedHunt(db, accountId, id, huntId, hours);
      return reply.send({ ok: true, memberIds });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/multiplayer-party/:id/hunt', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const memberIds = stopSharedHunt(db, accountId, id);
      return reply.send({ ok: true, memberIds });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/friends/:id', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      requireOwnedCharacter(db, accountId, id);
      return reply.send({ friends: friendsStatus(db, accountId) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/friends/:id', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      const body = (request.body ?? {}) as { name?: unknown };
      const name = String(body.name ?? '').trim();
      if (!name) throw new GameError('Informe o nome do personagem.', 422);
      addFriend(db, accountId, id, name);
      return reply.send({ friends: friendsStatus(db, accountId) });
    } catch (error) { return fail(reply, error); }
  });

  app.delete('/api/friends/:id/:friendId', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const params = request.params as { id: string; friendId: string };
      removeFriend(db, accountId, Number(params.id), Number(params.friendId));
      return reply.send({ friends: friendsStatus(db, accountId) });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/friends/:id/activity', async (request, reply) => {
    try {
      const accountId = requireAccount(db, request);
      const id = Number((request.params as { id: string }).id);
      requireOwnedCharacter(db, accountId, id);
      const body = (request.body ?? {}) as { activity?: unknown };
      if (body.activity !== 'training') throw new GameError('Atividade inválida.', 422);
      db.setWorld(activityKey(id), String(Date.now()));
      return reply.send({ ok: true });
    } catch (error) { return fail(reply, error); }
  });
}
