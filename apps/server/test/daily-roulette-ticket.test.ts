import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';

let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  ({ app, db } = await createApp({ databaseFile: ':memory:' }));
});

afterEach(async () => {
  await app.close();
});

async function post(url: string, payload: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as Record<string, unknown>,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('daily roulette ticket', () => {
  it('grants exactly one shared ticket when the account claims the daily', async () => {
    const token = (await post('/api/register', {
      username: 'daily-ticket',
      password: 'hunter2hunter2',
    })).json().token as string;

    const firstCharacter = (await post('/api/characters', {
      name: 'Ticket One',
      vocationId: 4,
    }, token)).json().character as { id: number };

    const secondCharacter = (await post('/api/characters', {
      name: 'Ticket Two',
      vocationId: 1,
    }, token)).json().character as { id: number };

    const accountId = db.findCharacter(firstCharacter.id)!.accountId;

    const claimed = await post(`/api/characters/${firstCharacter.id}/act`, { type: 'daily' }, token);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().rouletteTickets).toBe(1);
    expect(claimed.json().ticketBalance).toBe(1);
    expect(claimed.json().character.rouletteTickets).toBe(1);
    expect(db.getWorld(`roulette-tickets:${accountId}`)).toBe('1');

    const duplicate = await post(`/api/characters/${secondCharacter.id}/act`, { type: 'daily' }, token);
    expect(duplicate.statusCode).toBe(409);
    expect(db.getWorld(`roulette-tickets:${accountId}`)).toBe('1');
  });
});
