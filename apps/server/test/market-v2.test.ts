import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { items } from '@tibia-idle/data';
import type { CharacterState } from '@tibia-idle/sim';
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

async function get(url: string, token?: string) {
  return app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function makeAccount(username: string, characterName: string) {
  const token = (await post('/api/register', { username, password: 'hunter2hunter2' })).json().token as string;
  const character = (await post('/api/characters', { name: characterName, vocationId: 4 }, token)).json().character as { id: number };
  return { token, character };
}

function patchState(id: number, mutate: (state: CharacterState) => void) {
  const row = db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  mutate(state);
  db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

function stateOf(id: number): CharacterState {
  return JSON.parse(db.findCharacter(id)!.state) as CharacterState;
}

function ownedItemCount(state: CharacterState, itemId: number): number {
  const stacks = [state.warehouse ?? [], state.backpackContents ?? [], state.supplies ?? []];
  const stacked = stacks.reduce(
    (total, list) => total + list.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.count, 0),
    0,
  );
  const equipped = Object.values(state.equipment ?? {}).filter((id) => id === itemId).length;
  return stacked + equipped;
}

describe('Market V2', () => {
  it('lists by unit price, buys partial quantity, charges 2% fee and keeps the remainder', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    const seller = await makeAccount('market-seller', 'Mercador');
    const buyer = await makeAccount('market-buyer', 'Comprador Dois');

    patchState(seller.character.id, (state) => {
      state.level = 20;
      state.warehouse = [{ itemId: item.id, count: 3 }];
      state.gold = 1_000;
    });
    patchState(buyer.character.id, (state) => {
      state.level = 20;
      state.gold = 10_000;
    });

    const listed = await post(`/api/market-v2/${seller.character.id}/list`, {
      itemId: item.id,
      count: 3,
      unitPrice: 100,
    }, seller.token);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().snapshot.myOffers[0].count).toBe(3);
    expect(listed.json().snapshot.myOffers[0].unitPrice).toBe(100);

    const market = await get(`/api/market-v2/${buyer.character.id}`, buyer.token);
    expect(market.statusCode, market.body).toBe(200);
    expect(market.json().items.find((entry: { itemId: number }) => entry.itemId === item.id)?.available).toBe(3);

    const bought = await post(`/api/market-v2/${buyer.character.id}/buy`, {
      itemId: item.id,
      count: 2,
    }, buyer.token);
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().spent).toBe(200);
    expect(bought.json().snapshot.history[0].itemId).toBe(item.id);

    const buyerState = stateOf(buyer.character.id);
    expect(buyerState.gold).toBe(9_800);
    expect(ownedItemCount(buyerState, item.id)).toBeGreaterThanOrEqual(2);

    const sellerState = stateOf(seller.character.id);
    expect(sellerState.gold).toBe(1_196);

    const after = await get(`/api/market-v2/${buyer.character.id}`, buyer.token);
    const remaining = after.json().items.find((entry: { itemId: number }) => entry.itemId === item.id);
    expect(remaining?.available).toBe(1);
    expect(remaining?.lowestPrice).toBe(100);
  });

  it('lets the seller cancel an offer and returns the item to the Depot', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    const seller = await makeAccount('market-cancel', 'Cancelador');
    patchState(seller.character.id, (state) => {
      state.level = 20;
      state.warehouse = [{ itemId: item.id, count: 2 }];
    });

    const listed = await post(`/api/market-v2/${seller.character.id}/list`, {
      itemId: item.id,
      count: 2,
      unitPrice: 75,
    }, seller.token);
    const listingId = listed.json().listingId as number;

    const cancelled = await post(`/api/market-v2/${seller.character.id}/cancel`, { listingId }, seller.token);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().snapshot.myOffers).toHaveLength(0);
    expect(stateOf(seller.character.id).warehouse.find((stack) => stack.itemId === item.id)?.count).toBe(2);
  });

  it('blocks trading below the minimum level', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    const player = await makeAccount('market-low', 'Novato Market');
    patchState(player.character.id, (state) => {
      state.level = 2;
      state.warehouse = [{ itemId: item.id, count: 1 }];
    });
    const response = await post(`/api/market-v2/${player.character.id}/list`, {
      itemId: item.id,
      count: 1,
      unitPrice: 10,
    }, player.token);
    expect(response.statusCode).toBe(403);
  });
});