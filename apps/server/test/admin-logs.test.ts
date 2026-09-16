import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { items } from '@tibia-idle/data';
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

function patchState(id: number, mutate: (state: CharacterState) => void) {
  const row = context.db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  mutate(state);
  context.db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

describe('administrator audit logs', () => {
  it('requires administrator access and exposes persisted chat history', async () => {
    const adminToken = await register('admin');
    const playerToken = await register('auditplayer');
    const characterId = await createCharacter(playerToken, 'Audit Player');

    const sent = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/act`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { type: 'chat', channel: 'geral', body: 'Mensagem normal para o histórico.' },
    });
    expect(sent.statusCode, sent.body).toBe(200);

    const denied = await context.app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const logs = await context.app.inject({
      method: 'GET',
      url: '/api/admin/logs?limit=300',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(logs.statusCode, logs.body).toBe(200);
    expect(logs.json().chat.some((entry: { actor: string; summary: string }) =>
      entry.actor === 'Audit Player' && entry.summary === 'Mensagem normal para o histórico.',
    )).toBe(true);
  });

  it('records blocked chat attempts in the Suspeito log', async () => {
    const adminToken = await register('admin');
    const playerToken = await register('suspectplayer');
    const characterId = await createCharacter(playerToken, 'Suspect Player');

    const blocked = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/act`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { type: 'chat', channel: 'geral', body: 'acesse https://example.com/agora' },
    });
    expect(blocked.statusCode).toBe(422);

    const logs = await context.app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(logs.statusCode, logs.body).toBe(200);
    const suspicious = logs.json().suspicious as Array<{ actor?: string; action: string; reason?: string; details?: { message?: string } }>;
    expect(suspicious.some((entry) =>
      entry.actor === 'Suspect Player'
      && entry.action === 'chat_link_blocked'
      && entry.reason?.includes('link bloqueado')
      && entry.details?.message?.includes('example.com'),
    )).toBe(true);
  });

  it('records market activity for administrator review', async () => {
    const adminToken = await register('admin');
    const playerToken = await register('marketlogger');
    const characterId = await createCharacter(playerToken, 'Market Logger');
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    patchState(characterId, (state) => {
      state.level = Math.max(state.level, 20);
      state.warehouse = [{ itemId: item.id, count: 3 }];
    });

    const listed = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${characterId}/act`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { type: 'market-list', itemId: item.id, count: 1, price: 1234, currency: 'gold' },
    });
    expect(listed.statusCode, listed.body).toBe(200);

    const logs = await context.app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(logs.statusCode, logs.body).toBe(200);
    expect(logs.json().market.some((entry: { actor?: string; summary: string }) =>
      entry.actor === 'Market Logger' && entry.summary.includes('anunciou'),
    )).toBe(true);
  });
});
