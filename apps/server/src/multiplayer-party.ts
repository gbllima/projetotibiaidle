import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import type { CharacterRow, Database } from './db.js';
import { startHunt, stopHunt } from './game.js';
import { GameError } from './settle.js';

const PARTY_CAP = 5;
const INVITE_TTL_MS = 15 * 60_000;

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

export function multiplayerPartyStatus(db: Database, characterId: number) {
  const leaderId = leaderFor(db, characterId);
  const ids = leaderId ? parseIds(db.getWorld(partyKey(leaderId))) : [];
  const invite = pendingInvite(db, characterId);
  const inviter = invite ? db.findCharacter(invite.leaderId) : null;
  return {
    active: ids.length > 1,
    leaderId: leaderId ?? undefined,
    isLeader: Boolean(leaderId && leaderId === characterId),
    maxMembers: PARTY_CAP,
    members: ids.flatMap((id) => {
      const row = db.findCharacter(id);
      return row ? [characterSummary(row)] : [];
    }),
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

function dissolve(db: Database, leaderId: number): void {
  const ids = parseIds(db.getWorld(partyKey(leaderId)));
  for (const id of ids) {
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
  const started: number[] = [];
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
      if (alreadyThere) continue;
      startHunt(db, row.accountId, id, huntId, Date.now(), hours);
      started.push(id);
    }
    return ids;
  } catch (error) {
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
}
