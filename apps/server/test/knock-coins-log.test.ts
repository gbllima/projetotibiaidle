import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CharacterState } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
});

afterEach(async () => {
  await context.app.close();
});

async function register(username: string) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().token as string;
}

async function createCharacter(token: string, name: string) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, vocationId: 4 },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().character.id as number;
}

function setCoins(characterId: number, coins: number) {
  const row = context.db.findCharacter(characterId)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.coins = coins;
  context.db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

describe('Knock Coins administrator log', () => {
  it('requires admin and records coin orders, paid purchases and store spending', async () => {
    const adminToken = await register('admin');
    const playerToken = await register('coinlogger');
    const characterId = await createCharacter(playerToken, 'Coin Logger');
    setCoins(characterId, 1_000);

    const denied = await context.app.inject({
      method: 'GET',
      url: '/api/admin/knock-coins-log',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const orderResponse = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/act`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { type: 'buy-coins', pack: 'pack100' },
    });
    expect(orderResponse.statusCode, orderResponse.body).toBe(200);
    const orderId = Number(orderResponse.json().orderId);
    expect(orderId).toBeGreaterThan(0);

    const spent = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/act`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { type: 'shop', sku: 'vip7' },
    });
    expect(spent.statusCode, spent.body).toBe(200);

    const fulfilled = await context.app.inject({
      method: 'POST',
      url: '/api/admin',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'fulfill', orderId },
    });
    expect(fulfilled.statusCode, fulfilled.body).toBe(200);

    const logs = await context.app.inject({
      method: 'GET',
      url: '/api/admin/knock-coins-log?limit=500',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(logs.statusCode, logs.body).toBe(200);

    const body = logs.json() as {
      orders: Array<{ id: number; username: string; coins: number; status: string; brl: number }>;
      transactions: Array<{ action: string; actor?: string; coins: number; direction: string; details?: Record<string, unknown> }>;
      counts: { paid: number; pending: number };
      totals: { purchasedCoins: number; spentCoins: number };
    };

    expect(body.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: orderId, username: 'coinlogger', coins: 100, status: 'paid' }),
    ]));
    expect(body.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'shop_spend', actor: 'Coin Logger', coins: 150, direction: 'debit' }),
      expect.objectContaining({ action: 'purchase_paid', coins: 100, direction: 'credit' }),
    ]));
    const shop = body.transactions.find((entry) => entry.action === 'shop_spend');
    expect(shop?.details).toMatchObject({ sku: 'vip7' });
    expect(body.counts.paid).toBe(1);
    expect(body.counts.pending).toBe(0);
    expect(body.totals.purchasedCoins).toBe(100);
    expect(body.totals.spentCoins).toBeGreaterThanOrEqual(150);
  });
});
