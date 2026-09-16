import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { economyAct, ticketBalance } from '../src/economy.js';

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
  it('grants one lifetime ticket on the seventh account daily and never grants another', async () => {
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
    const dayMs = 86_400_000;
    const start = Date.UTC(2026, 0, 1, 12, 0, 0);

    for (let day = 0; day < 6; day += 1) {
      const result = economyAct(db, accountId, firstCharacter.id, { type: 'daily' }, start + day * dayMs);
      expect(result.extra?.rouletteTickets).toBe(0);
      expect(ticketBalance(db, accountId)).toBe(0);
    }

    const seventhAt = start + 6 * dayMs;
    const seventh = economyAct(db, accountId, firstCharacter.id, { type: 'daily' }, seventhAt);
    expect(seventh.extra?.rouletteTickets).toBe(1);
    expect(seventh.extra?.ticketBalance).toBe(1);
    expect(ticketBalance(db, accountId)).toBe(1);
    expect(db.getWorld(`roulette-tickets:${accountId}`)).toBe('1');

    expect(() => economyAct(db, accountId, secondCharacter.id, { type: 'daily' }, seventhAt))
      .toThrowError('Daily already claimed on this account today.');

    const spin = economyAct(db, accountId, secondCharacter.id, { type: 'roleta-spin' }, seventhAt + 1_000);
    expect(spin.extra?.ticketBalance).toBe(0);
    expect(ticketBalance(db, accountId)).toBe(0);
    expect(db.getWorld(`roulette-tickets:${accountId}`)).toBe('-1');

    let secondCycleSeventh: ReturnType<typeof economyAct> | null = null;
    for (let day = 7; day < 14; day += 1) {
      const result = economyAct(db, accountId, firstCharacter.id, { type: 'daily' }, start + day * dayMs);
      expect(result.extra?.rouletteTickets).toBe(0);
      expect(ticketBalance(db, accountId)).toBe(0);
      if (day === 13) secondCycleSeventh = result;
    }

    expect(secondCycleSeventh?.extra?.streak).toBe(7);
    expect(secondCycleSeventh?.extra?.rouletteTickets).toBe(0);
    expect(db.getWorld(`roulette-tickets:${accountId}`)).toBe('-1');
  });
});
