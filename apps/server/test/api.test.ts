import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TICK_MS } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { setHuntCap } from '../src/queue.js';

/**
 * End-to-end coverage of the account, character and hunt flow against an
 * in-memory database.
 */

let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  ({ app, db } = await createApp({ databaseFile: ':memory:' }));
});

afterEach(async () => {
  setHuntCap(8);
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

async function signUp(username = 'tester', password = 'hunter2hunter2') {
  const response = await post('/api/register', { username, password });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

async function makeCharacter(token: string, name = 'Bowen', vocationId = 4) {
  const response = await post('/api/characters', { name, vocationId }, token);
  expect(response.statusCode, response.body).toBe(201);
  return response.json().character as { id: number; level: number; gold: number };
}

describe('accounts', () => {
  it('registers and returns a usable token', async () => {
    const token = await signUp();
    const response = await get('/api/characters', token);
    expect(response.statusCode).toBe(200);
    expect(response.json().characters).toEqual([]);
  });

  it('rejects a duplicate username', async () => {
    await signUp('dupe');
    const again = await post('/api/register', { username: 'dupe', password: 'hunter2hunter2' });
    expect(again.statusCode).toBe(409);
  });

  it('rejects a short password', async () => {
    const response = await post('/api/register', { username: 'shorty', password: 'abc' });
    expect(response.statusCode).toBe(400);
  });

  it('logs in with the right password and refuses the wrong one', async () => {
    await signUp('returning', 'correct-horse');
    expect((await post('/api/login', { username: 'returning', password: 'correct-horse' })).statusCode).toBe(200);
    expect((await post('/api/login', { username: 'returning', password: 'wrong-horse' })).statusCode).toBe(401);
  });

  it('refuses unauthenticated access', async () => {
    expect((await get('/api/characters')).statusCode).toBe(401);
    expect((await get('/api/characters', 'not-a-real-token')).statusCode).toBe(401);
  });

  it('lets a guest play and later claim the account', async () => {
    const guest = await post('/api/guest', {});
    expect(guest.statusCode, guest.body).toBe(200);
    const token = guest.json().token as string;
    expect(guest.json().guest).toBe(true);

    const roster = await get('/api/characters', token);
    expect(roster.statusCode).toBe(200);
    expect(roster.json().account.guest).toBe(true);
    expect(roster.json().account.slots).toBe(5);

    const claimed = await post('/api/claim', { username: 'keeper', password: 'hunter2hunter2' }, token);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().guest).toBe(false);
    expect(claimed.json().username).toBe('keeper');

    const login = await post('/api/login', { username: 'keeper', password: 'hunter2hunter2' });
    expect(login.statusCode).toBe(200);

    const again = await post('/api/claim', { username: 'other', password: 'hunter2hunter2' }, claimed.json().token as string);
    expect(again.statusCode).toBe(409);
  });
});

describe('characters', () => {
  it('creates a level 8 character with starting gear and gold', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    expect(character.level).toBe(8);
    expect(character.gold).toBeGreaterThan(0);
  });

  it('rejects a duplicate name', async () => {
    const token = await signUp();
    await makeCharacter(token, 'Twin');
    const again = await post('/api/characters', { name: 'Twin', vocationId: 4 }, token);
    expect(again.statusCode).toBe(409);
  });

  it('rejects an unplayable vocation', async () => {
    const token = await signUp();
    const response = await post('/api/characters', { name: 'Ghost', vocationId: 99 }, token);
    expect(response.statusCode).toBe(400);
  });

  it('hides characters belonging to another account', async () => {
    const mine = await signUp('mine');
    const character = await makeCharacter(mine, 'Private');
    const theirs = await signUp('theirs');
    expect((await get(`/api/characters/${character.id}`, theirs)).statusCode).toBe(404);
  });
});

describe('hunting', () => {
  it('lists hunts annotated for the character', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const response = await get(`/api/characters/${character.id}/hunts`, token);
    expect(response.statusCode).toBe(200);

    const hunts = response.json().hunts as Array<{ recommendedLevel: number | null; unlocked: boolean; recommended?: boolean }>;
    expect(hunts.length).toBeGreaterThan(100);
    expect(hunts.some((h) => h.unlocked)).toBe(true);
    expect(hunts.some((h) => !h.unlocked)).toBe(true);
    expect(hunts.filter((h) => h.recommended).length).toBe(1);
  });

  it('starts a hunt with partial supplies when gold covers less than one hour', async () => {
    const token = await signUp('partial-pack');
    const character = await makeCharacter(token, 'PoorKnight');

    const row = db.findCharacter(character.id)!;
    const state = JSON.parse(row.state) as { gold: number; level: number };
    state.gold = 900;
    state.level = 12;
    db.saveCharacter(character.id, JSON.stringify(state), null, Date.now());

    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    const hunt = hunts.find((h) => h.unlocked);
    expect(hunt).toBeDefined();

    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: hunt!.id, hours: 1 }, token);
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().character.session.huntId).toBe(hunt!.id);
    expect(started.json().character.gold).toBeLessThan(900);
    expect(started.json().character.canAffordTrip).toBe(true);
  });

  it('starts a hunt and accrues progress over time', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);

    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    const hunt = hunts.find((h) => h.unlocked);
    expect(hunt).toBeDefined();

    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: hunt!.id }, token);
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().character.session.huntId).toBe(hunt!.id);
    expect(started.json().character.live.huntId).toBe(hunt!.id);
    expect(started.json().character.live.rngState).toHaveLength(4);

    // Rewind the settlement clock to simulate ten minutes of absence.
    const row = db.findCharacter(character.id)!;
    const tenMinutes = 10 * 60 * 1000;
    db.saveCharacter(row.id, row.state, row.session, Date.now() - tenMinutes);

    const after = await get(`/api/characters/${character.id}`, token);
    const settlement = after.json().settlement as {
      elapsedSeconds: number; offline: boolean; efficiency: number;
    };
    expect(settlement.elapsedSeconds).toBeGreaterThanOrEqual(Math.floor(tenMinutes / 1000) - 1);
    expect(settlement.offline).toBe(true);
    expect(settlement.efficiency).toBe(0.7);

    const session = after.json().character.session as { totals: { kills: number; ticks: number } };
    expect(session.totals.ticks).toBe(Math.floor(tenMinutes / TICK_MS));
    expect(session.totals.kills).toBeGreaterThan(0);
    const bestiary = after.json().character.bestiary as Record<string, number>;
    const recorded = Object.values(bestiary).reduce((sum, n) => sum + n, 0);
    expect(recorded).toBe(session.totals.kills);
  });

  it('refuses a second hunt while one is running', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    const hunt = hunts.find((h) => h.unlocked)!;

    await post(`/api/characters/${character.id}/hunt`, { huntId: hunt.id }, token);
    const again = await post(`/api/characters/${character.id}/hunt`, { huntId: hunt.id }, token);
    expect(again.statusCode).toBe(409);
  });

  it('switches caves when the character is already hunting', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean; partyLocked?: boolean;
    }>;
    const unlocked = hunts.filter((h) => h.unlocked && !h.partyLocked);
    expect(unlocked.length).toBeGreaterThan(1);
    const first = unlocked[0]!;
    const next = unlocked[1]!;

    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: first.id }, token);
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().character.session.huntId).toBe(first.id);

    const switched = await post(`/api/characters/${character.id}/hunt`, { huntId: next.id, hours: 1 }, token);
    expect(switched.statusCode, switched.body).toBe(200);
    expect(switched.json().character.session.huntId).toBe(next.id);
    expect(switched.json().character.queue).toBeNull();
  });

  it('refuses a hunt far above the character', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean; recommendedLevel: number | null;
    }>;
    const hunt = hunts.find((h) => (h.recommendedLevel ?? 0) > 200);
    expect(hunt).toBeDefined();

    const response = await post(`/api/characters/${character.id}/hunt`, { huntId: hunt!.id }, token);
    expect(response.statusCode).toBe(422);
  });

  it('banks loot when the hunt is stopped', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    const hunt = hunts.find((h) => h.unlocked)!;

    await post(`/api/characters/${character.id}/hunt`, { huntId: hunt.id }, token);
    const row = db.findCharacter(character.id)!;
    db.saveCharacter(row.id, row.state, row.session, Date.now() - 20 * 60 * 1000);

    const stopped = await app.inject({
      method: 'DELETE',
      url: `/api/characters/${character.id}/hunt`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().character.gold).toBeGreaterThan(0);
    expect(stopped.json().character.session).toBeNull();
  });

  it('queues a second hunter when the cave is full and promotes on leave', async () => {
    setHuntCap(1);
    const firstToken = await signUp('alpha');
    const secondToken = await signUp('bravo');
    const first = await makeCharacter(firstToken, 'Alpha');
    const second = await makeCharacter(secondToken, 'Bravo');

    const hunts = (await get(`/api/characters/${first.id}/hunts`, firstToken)).json().hunts as Array<{
      id: string; unlocked: boolean; slots: { used: number; cap: number; queued: number };
    }>;
    const hunt = hunts.find((entry) => entry.unlocked)!;
    expect(hunt.slots.cap).toBe(1);

    const started = await post(`/api/characters/${first.id}/hunt`, { huntId: hunt.id }, firstToken);
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().character.session.huntId).toBe(hunt.id);
    expect(started.json().character.queue).toBeNull();

    const queued = await post(`/api/characters/${second.id}/hunt`, { huntId: hunt.id }, secondToken);
    expect(queued.statusCode, queued.body).toBe(200);
    expect(queued.json().character.session).toBeNull();
    expect(queued.json().character.queue).toMatchObject({ huntId: hunt.id, position: 1, size: 1 });

    const listed = ((await get(`/api/characters/${second.id}/hunts`, secondToken)).json().hunts as typeof hunts)
      .find((entry) => entry.id === hunt.id)!;
    expect(listed.slots).toEqual({ used: 1, cap: 1, queued: 1 });

    const stopped = await app.inject({
      method: 'DELETE',
      url: `/api/characters/${first.id}/hunt`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);

    const promoted = await get(`/api/characters/${second.id}`, secondToken);
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().character.session?.huntId).toBe(hunt.id);
    expect(promoted.json().character.queue).toBeNull();
  });
});

describe('offline settlement', () => {
  it('treats a short gap as live, not offline', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((h) => h.unlocked)!.id }, token);

    const row = db.findCharacter(character.id)!;
    db.saveCharacter(row.id, row.state, row.session, Date.now() - 10_000);

    const after = await get(`/api/characters/${character.id}`, token);
    const settlement = after.json().settlement as { offline: boolean; efficiency: number };
    expect(settlement.offline).toBe(false);
    expect(settlement.efficiency).toBe(1);
  });

  it('caps a very long absence', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((h) => h.unlocked)!.id }, token);

    const row = db.findCharacter(character.id)!;
    db.saveCharacter(row.id, row.state, row.session, Date.now() - 100 * 60 * 60 * 1000);

    const after = await get(`/api/characters/${character.id}`, token);
    const settlement = after.json().settlement as {
      elapsedSeconds: number; discardedSeconds: number; capHours: number;
    };
    expect(settlement.capHours).toBe(8);
    expect(settlement.elapsedSeconds).toBeLessThanOrEqual(8 * 60 * 60);
    expect(settlement.elapsedSeconds).toBeGreaterThan(7 * 60 * 60);
    expect(settlement.discardedSeconds).toBeGreaterThan(0);
  }, 30_000);

  it('lets VIP catch up for 24 hours', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((h) => h.unlocked)!.id }, token);

    const row = db.findCharacter(character.id)!;
    const session = JSON.parse(row.session!) as { character: { premium: boolean; vipUntil: number } };
    session.character.premium = true;
    session.character.vipUntil = Date.now() + 7 * 86_400_000;
    db.saveCharacter(row.id, row.state, JSON.stringify(session), Date.now() - 100 * 60 * 60 * 1000);

    const after = await get(`/api/characters/${character.id}`, token);
    const settlement = after.json().settlement as {
      elapsedSeconds: number; discardedSeconds: number; capHours: number;
    };
    expect(settlement.capHours).toBe(24);
    expect(settlement.elapsedSeconds).toBeGreaterThan(23 * 60 * 60);
    expect(settlement.elapsedSeconds).toBeLessThanOrEqual(24 * 60 * 60);
    expect(settlement.discardedSeconds).toBeGreaterThan(0);
  }, 30_000);

  it('regenerates stamina while idle', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const row = db.findCharacter(character.id)!;
    const state = JSON.parse(row.state) as { stamina: number };
    state.stamina = 2000;
    db.saveCharacter(row.id, JSON.stringify(state), null, Date.now() - 30 * 60 * 1000);

    const after = await get(`/api/characters/${character.id}`, token);
    expect(after.json().character.stamina).toBe(2010);
  });

  it('refuses a party-only hunt without enough slots', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; partyNeed: number; recommendedLevel: number | null;
    }>;
    const hunt = hunts.find((entry) => entry.partyNeed >= 2 && entry.recommendedLevel !== null);
    expect(hunt).toBeDefined();

    const row = db.findCharacter(character.id)!;
    const state = JSON.parse(row.state) as { level: number; gold: number; partySlots: number };
    state.level = Math.max(80, hunt!.recommendedLevel ?? 80);
    state.gold = 1_000_000;
    state.partySlots = 1;
    db.saveCharacter(row.id, JSON.stringify(state), null, Date.now());

    const response = await post(`/api/characters/${character.id}/hunt`, { huntId: hunt!.id }, token);
    expect(response.statusCode).toBe(422);
    expect(String(response.json().error)).toMatch(/party/i);
  });

  it('settles the same whether read once or repeatedly', async () => {
    const token = await signUp();
    const character = await makeCharacter(token);
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{
      id: string; unlocked: boolean;
    }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((h) => h.unlocked)!.id }, token);

    const row = db.findCharacter(character.id)!;
    const start = Date.now() - 5 * 60 * 1000;
    db.saveCharacter(row.id, row.state, row.session, start);

    await get(`/api/characters/${character.id}`, token);
    await get(`/api/characters/${character.id}`, token);
    const final = await get(`/api/characters/${character.id}`, token);

    // Reading three times must not multiply progress: each settlement only
    // covers the time since the previous one.
    const ticks = (final.json().character.session as { totals: { ticks: number } }).totals.ticks;
    const expected = Math.floor((5 * 60 * 1000) / TICK_MS);
    expect(ticks).toBeGreaterThanOrEqual(expected);
    expect(ticks).toBeLessThan(expected + 40);
  });
});
