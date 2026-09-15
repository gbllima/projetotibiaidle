import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { items } from '@tibia-idle/data';
import type { CharacterState } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { marketPriceRule } from '../src/market-price-protection.js';

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

async function get(url: string, token?: string) {
  return app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function player() {
  const token = (await post('/api/register', { username: 'price-guard', password: 'hunter2hunter2' })).json().token as string;
  const character = (await post('/api/characters', { name: 'Guardiao', vocationId: 4 }, token)).json().character as { id: number };
  return { token, character };
}

function patchState(id: number, mutate: (state: CharacterState) => void) {
  const row = db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  mutate(state);
  db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

describe('Market price protection', () => {
  it('blocks a listing below the absolute/NPC floor even through the API', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) >= 20)!;
    const { token, character } = await player();
    patchState(character.id, (state) => {
      state.level = 20;
      state.warehouse = [{ itemId: item.id, count: 1 }];
    });

    const ruleResponse = await get(`/api/market-price-protection/${item.id}`, token);
    expect(ruleResponse.statusCode, ruleResponse.body).toBe(200);
    expect(ruleResponse.json().minAllowedPrice).toBeGreaterThanOrEqual(item.sellPrice ?? 0);

    const response = await post(`/api/market-v2/${character.id}/list`, {
      itemId: item.id,
      count: 1,
      unitPrice: Math.max(1, (item.sellPrice ?? 20) - 1),
    }, token);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('mínimo permitido');
  });

  it('uses 25% of the recent median when it is higher than the NPC floor', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    const now = Date.now();
    const reference = Math.max(4_000, (item.sellPrice ?? 1) * 20);
    db.setWorld('market:v2:history', JSON.stringify([
      { itemId: item.id, unitPrice: reference, at: now - 5_000 },
      { itemId: item.id, unitPrice: reference, at: now - 4_000 },
      { itemId: item.id, unitPrice: reference, at: now - 3_000 },
      { itemId: item.id, unitPrice: reference, at: now - 2_000 },
      { itemId: item.id, unitPrice: reference, at: now - 1_000 },
    ]));

    const rule = marketPriceRule(db, item.id, now)!;
    expect(rule.medianRecentPrice).toBe(reference);
    expect(rule.minAllowedPrice).toBe(Math.max(10, item.sellPrice ?? 0, Math.ceil(reference * 0.25)));
    expect(rule.warningBelowPrice).toBe(Math.ceil(reference * 0.5));
  });

  it('applies the same floor to the legacy market action and blocks Coins listings', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) >= 20)!;
    const { token, character } = await player();
    patchState(character.id, (state) => {
      state.level = 20;
      state.warehouse = [{ itemId: item.id, count: 3 }];
    });

    const underpriced = await post(`/api/characters/${character.id}/act`, {
      type: 'market-list',
      itemId: item.id,
      count: 2,
      price: 2,
      currency: 'gold',
    }, token);
    expect(underpriced.statusCode).toBe(400);
    expect(underpriced.json().error).toContain('mínimo permitido');

    const coins = await post(`/api/characters/${character.id}/act`, {
      type: 'market-list',
      itemId: item.id,
      count: 1,
      price: 100,
      currency: 'coins',
    }, token);
    expect(coins.statusCode).toBe(409);
    expect(coins.json().error).toContain('apenas Gold');
  });
});