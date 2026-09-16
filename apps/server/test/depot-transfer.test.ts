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

async function player() {
  const token = (await post('/api/register', { username: 'depot-transfer', password: 'hunter2hunter2' })).json().token as string;
  const character = (await post('/api/characters', { name: 'Depotter', vocationId: 1 }, token)).json().character as { id: number };
  return { token, character };
}

function patchState(id: number, mutate: (state: CharacterState) => void) {
  const row = db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  mutate(state);
  db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

describe('Depot to Backpack transfer', () => {
  it('moves equipment from the Depot into the Backpack without routing it through Supply', async () => {
    const sword = items.find((item) => item.weaponType === 'sword' && item.attack > 0)!;
    const { token, character } = await player();

    patchState(character.id, (state) => {
      state.warehouse = [{ itemId: sword.id, count: 1 }];
      state.backpackContents = [];
    });

    const response = await post(`/api/characters/${character.id}/depot-to-backpack`, {
      itemId: sword.id,
      count: 1,
    }, token);

    expect(response.statusCode, response.body).toBe(200);

    const row = db.findCharacter(character.id)!;
    const state = JSON.parse(row.state) as CharacterState;
    expect(state.warehouse.some((stack) => stack.itemId === sword.id)).toBe(false);
    expect(state.backpackContents?.find((stack) => stack.itemId === sword.id)?.count).toBe(1);
    expect(state.supplies.some((stack) => stack.itemId === sword.id)).toBe(false);
  });
});
