import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
});

afterEach(async () => {
  await context.app.close();
});

async function register(username = 'secureuser', password = 'hunter2hunter2') {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    token: response.json().token as string,
    headers: { authorization: `Bearer ${response.json().token as string}` },
  };
}

async function createCharacter(token: string, name = 'Secure Knight') {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, vocationId: 4 },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().character as { id: number };
}

describe('security hardening', () => {
  it('adds browser security headers and disables API caching', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['content-security-policy']).toContain('https://fonts.googleapis.com');
    expect(response.headers['content-security-policy']).toContain('https://fonts.gstatic.com');
    expect(response.headers['content-security-policy']).toContain('https://opengameart.org');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('blocks executable code payloads server-side and records them as suspicious', async () => {
    const player = await register();
    const character = await createCharacter(player.token);

    const blocked = await context.app.inject({
      method: 'POST',
      url: `/api/characters/${character.id}/act`,
      headers: player.headers,
      payload: {
        type: 'chat',
        channel: 'geral',
        body: '<img src=x onerror=alert(1)>',
      },
    });

    expect(blocked.statusCode, blocked.body).toBe(422);
    expect(blocked.json().error).toBe('Conteúdo potencialmente executável ou malformado não é permitido.');

    const audit = JSON.parse(context.db.getWorld('admin:audit:v1') ?? '[]') as Array<Record<string, unknown>>;
    const incident = audit.find((entry) => entry['action'] === 'code_injection_blocked');
    expect(incident?.['category']).toBe('security');
    expect(incident?.['suspicious']).toBe(true);
    expect(incident?.['accountId']).toBeTruthy();
    expect(incident?.['characterId']).toBe(character.id);
  });

  it('rejects prototype-pollution keys in JSON bodies', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        username: 'prototypeuser',
        password: 'hunter2hunter2',
        prototype: { admin: true },
      },
    });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toContain('malformado');
  });

  it('does not weaken passwords by filtering their contents', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        username: 'strongpass',
        password: 'A<script>is-allowed-in-a-password!9',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('blocks source/configuration probes, including encoded paths, without exposing file existence', async () => {
    const paths = ['/src/app.ts', '/s%72c/app.ts', '/vite.config.js'];
    for (const url of paths) {
      const response = await context.app.inject({ method: 'GET', url });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(404);
      expect(response.json().error).toBe('Not found.');
    }

    const audit = JSON.parse(context.db.getWorld('admin:audit:v1') ?? '[]') as Array<Record<string, unknown>>;
    const sourceProbeEvents = audit.filter((entry) => entry['action'] === 'source_probe' && entry['suspicious'] === true);
    expect(sourceProbeEvents).toHaveLength(1);
  });

  it('blocks double-encoded traversal attempts', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/%252e%252e%252fsrc/app.ts',
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error).toBe('Requisição inválida.');

    const audit = JSON.parse(context.db.getWorld('admin:audit:v1') ?? '[]') as Array<Record<string, unknown>>;
    expect(audit.some((entry) => entry['action'] === 'malformed_url' && entry['suspicious'] === true)).toBe(true);
  });

  it('rejects oversized request bodies before application logic', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/register',
      payload: {
        username: 'oversized',
        password: `SafePassword9${'x'.repeat(300 * 1024)}`,
      },
    });
    expect(response.statusCode).toBe(413);
  });
});
