import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICK_MS, WAVE_PACK, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { loadCharacter } from '../src/game.js';

const HUNT_ID = 'amazon-camp';
const START = 1_700_000_000_000;
const NORMAL_WAVE_DELAY_MS = 3_000;

type Player = {
  accountId: number;
  token: string;
  headers: Record<string, string>;
  id: number;
  name: string;
};

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
  await context.app.ready();
});

afterEach(async () => {
  await context.app.close();
});

async function player(username: string, name: string): Promise<Player> {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const token = registered.json().token as string;
  const accountId = registered.json().accountId as number;
  const headers = { authorization: `Bearer ${token}` };
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name, vocationId: 4, weapon: 'sword' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().character.id as number;

  const row = context.db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.level = 50;
  state.gold = 1_000_000;
  context.db.saveCharacter(id, JSON.stringify(state), null, row.settledAt);
  return { accountId, token, headers, id, name };
}

async function formMultiplayerParty(leader: Player, member: Player): Promise<void> {
  const request = await context.app.inject({
    method: 'POST',
    url: `/api/social/${leader.id}/friend-request`,
    headers: leader.headers,
    payload: { name: member.name },
  });
  expect(request.statusCode, request.body).toBe(200);

  const friendship = await context.app.inject({
    method: 'POST',
    url: `/api/social/${member.id}/friend-request/accept`,
    headers: member.headers,
    payload: { fromId: leader.id },
  });
  expect(friendship.statusCode, friendship.body).toBe(200);

  const invite = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${leader.id}/invite`,
    headers: leader.headers,
    payload: { name: member.name },
  });
  expect(invite.statusCode, invite.body).toBe(200);

  const accepted = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${member.id}/accept`,
    headers: member.headers,
  });
  expect(accepted.statusCode, accepted.body).toBe(200);

  const started = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${leader.id}/hunt`,
    headers: leader.headers,
    payload: { huntId: HUNT_ID, hours: 1 },
  });
  expect(started.statusCode, started.body).toBe(200);
  expect(started.json().memberIds).toEqual([leader.id, member.id]);
}

function putAtWaveTwoBoundary(id: number): void {
  const row = context.db.findCharacter(id)!;
  expect(row.session).not.toBeNull();
  const session = JSON.parse(row.session!) as HuntSession & {
    reinforcementWaveIndex?: number;
    reinforcementReadyTick?: number;
    nextWaveAtTick?: number;
  };
  session.startedAt = START;
  session.tick = 0;
  session.totals.ticks = 0;
  session.totals.kills = WAVE_PACK[0]!;
  session.active = [];
  session.spawnCredits = 0;
  session.reinforcementWaveIndex = 0;
  session.reinforcementReadyTick = undefined;
  session.nextWaveAtTick = undefined;
  session.character.health = 1_000_000_000;
  session.character.mana = 0;
  session.character.policy.autoAttack = false;
  session.character.policy.fleeAt = 0;
  session.character.policy.healthPotionAt = 0;
  session.character.policy.manaPotionAt = 0;
  session.character.policy.stopWhenOutOfSupplies = false;
  context.db.saveCharacter(id, row.state, JSON.stringify(session), START);
}

function activeCount(id: number): number {
  const row = context.db.findCharacter(id)!;
  const session = JSON.parse(row.session!) as HuntSession;
  return session.active.length;
}

describe('multiplayer wave timing', () => {
  it('spawns the next Amazon Camp wave at 3s for both leader and member account', async () => {
    expect(NORMAL_WAVE_DELAY_MS / TICK_MS).toBe(12);
    const leader = await player('waveleader', 'Wave Leader');
    const member = await player('wavemember', 'Wave Member');
    await formMultiplayerParty(leader, member);

    putAtWaveTwoBoundary(leader.id);
    putAtWaveTwoBoundary(member.id);

    // 11 ticks / 2.75s: neither account may see the next wave yet.
    loadCharacter(context.db, leader.accountId, leader.id, START + NORMAL_WAVE_DELAY_MS - TICK_MS);
    loadCharacter(context.db, member.accountId, member.id, START + NORMAL_WAVE_DELAY_MS - TICK_MS);
    expect(activeCount(leader.id)).toBe(0);
    expect(activeCount(member.id)).toBe(0);

    // Tick 12 / 3.00s: both independently persisted multiplayer sessions open
    // wave 2. No spawn-credit shortage may extend this empty-floor transition.
    loadCharacter(context.db, leader.accountId, leader.id, START + NORMAL_WAVE_DELAY_MS);
    loadCharacter(context.db, member.accountId, member.id, START + NORMAL_WAVE_DELAY_MS);
    expect(activeCount(leader.id)).toBeGreaterThan(0);
    expect(activeCount(member.id)).toBeGreaterThan(0);
  });
});
