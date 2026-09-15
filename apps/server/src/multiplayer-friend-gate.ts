import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db.js';

function friendsKey(accountId: number): string { return `friends:${accountId}`; }

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

function accountFromRequest(db: Database, request: FastifyRequest): number | null {
  const auth = request.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token ? db.accountIdForToken(token) : null;
}

function hasAcceptedFriendship(db: Database, accountId: number, friendAccountId: number): boolean {
  const ownSide = parseIds(db.getWorld(friendsKey(accountId)))
    .some((id) => db.findCharacter(id)?.accountId === friendAccountId);
  const otherSide = parseIds(db.getWorld(friendsKey(friendAccountId)))
    .some((id) => db.findCharacter(id)?.accountId === accountId);
  return ownSide && otherSide;
}

/**
 * Party invites are a social action and are only allowed between accounts that
 * already accepted each other as friends. The mutual check deliberately uses
 * both accounts, so the old one-sided friend endpoint cannot bypass the rule.
 */
export function registerMultiplayerFriendGate(app: FastifyInstance, db: Database): void {
  app.addHook('preHandler', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (request.method !== 'POST' || !/^\/api\/multiplayer-party\/\d+\/invite$/.test(pathname)) return;

    const accountId = accountFromRequest(db, request);
    if (accountId === null) return;

    const body = (request.body ?? {}) as { name?: unknown };
    const targetName = String(body.name ?? '').trim();
    if (!targetName) return;

    const target = db.findCharacterByName(targetName);
    if (!target || target.accountId === accountId) return;

    if (!hasAcceptedFriendship(db, accountId, target.accountId)) {
      return reply.status(403).send({
        error: 'Você só pode convidar para a Party Multiplayer jogadores que já aceitaram sua amizade.',
      });
    }
  });
}
