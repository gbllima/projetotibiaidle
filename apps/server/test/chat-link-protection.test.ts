import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { containsRestrictedChatLink } from '../src/chat-link-protection.js';

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
});

afterEach(async () => {
  await context.app.close();
});

async function createPlayer() {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username: 'chatlinks', password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const headers = { authorization: `Bearer ${registered.json().token}` };

  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name: 'Link Tester', vocationId: 4 },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { headers, id: created.json().character.id as number };
}

describe('chat link protection', () => {
  it('detects common external-link formats without blocking normal chat', () => {
    expect(containsRestrictedChatLink('https://example.com/teste')).toBe(true);
    expect(containsRestrictedChatLink('www.example.com')).toBe(true);
    expect(containsRestrictedChatLink('discord.gg/abc123')).toBe(true);
    expect(containsRestrictedChatLink('visite exemplo.com.br/agora')).toBe(true);
    expect(containsRestrictedChatLink('Hoje farmei 10.5kk, muito bom.')).toBe(false);
    expect(containsRestrictedChatLink('Alguém quer hunt level 100?')).toBe(false);
  });

  it('rejects links server-side and still accepts ordinary messages', async () => {
    const player = await createPlayer();

    const normal = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${player.id}/act`,
      headers: player.headers,
      payload: { type: 'chat', channel: 'geral', body: 'Alguém quer hunt comigo?' },
    });
    expect(normal.statusCode, normal.body).toBe(200);

    for (const body of [
      'entra https://example.com',
      'acesse www.example.com agora',
      'discord.gg/abc123',
      'meu site é exemplo.com.br/teste',
    ]) {
      const blocked = await context.app.inject({
        method: 'POST',
        url: `/api/characters/${player.id}/act`,
        headers: player.headers,
        payload: { type: 'chat', channel: 'geral', body },
      });
      expect(blocked.statusCode, blocked.body).toBe(422);
      expect(blocked.json().error).toBe('Links não são permitidos no chat interno.');
    }
  });
});
