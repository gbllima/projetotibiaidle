import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { containsRestrictedChatProfanity } from '../src/chat-profanity-protection.js';

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
    payload: { username: 'chatlanguage', password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const headers = { authorization: `Bearer ${registered.json().token}` };

  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name: 'Language Tester', vocationId: 4 },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { headers, id: created.json().character.id as number };
}

describe('chat profanity protection', () => {
  it('detects profanity, common obfuscation and acronyms', () => {
    for (const message of [
      'caralho',
      'P0RR4',
      'f.o.d.a',
      'f d p',
      'vai tomar no cu',
      'cuzão',
      'que merda',
    ]) {
      expect(containsRestrictedChatProfanity(message), message).toBe(true);
    }
  });

  it('does not block ordinary words just because they contain similar letters', () => {
    for (const message of [
      'O computador travou.',
      'Vamos para a cidade depois da hunt.',
      'Essa build está muito boa.',
      'Preciso comprar potion no market.',
      'Análise de dano concluída.',
    ]) {
      expect(containsRestrictedChatProfanity(message), message).toBe(false);
    }
  });

  it('rejects profanity server-side and still accepts ordinary messages', async () => {
    const player = await createPlayer();

    const normal = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${player.id}/act`,
      headers: player.headers,
      payload: { type: 'chat', channel: 'geral', body: 'Alguém quer hunt comigo?' },
    });
    expect(normal.statusCode, normal.body).toBe(200);

    for (const body of [
      'que merda',
      'P0RR4',
      'f.o.d.a',
      'f d p',
      'vai tomar no cu',
    ]) {
      const blocked = await context.app.inject({
        method: 'POST',
        url: `/api/characters/${player.id}/act`,
        headers: player.headers,
        payload: { type: 'chat', channel: 'geral', body },
      });
      expect(blocked.statusCode, blocked.body).toBe(422);
      expect(blocked.json().error).toBe('Palavras de baixo calão não são permitidas no chat interno.');
    }
  });
});
