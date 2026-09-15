import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICK_MS, WAVE_PACK, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { settle } from '../src/settle.js';

const HUNT_ID = 'amazon-camp';
const START = 1_700_000_000_000;
const NORMAL_WAVE_DELAY_MS = 3_000;

type Player = {
  accountId: number;
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
  return { accountId, headers, id, name };
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

function waveTwoBoundarySession(id: number): HuntSession {
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
  return session;
}

describe('multiplayer wave timing', () => {
  it('spawns the next Amazon Camp wave at 3s for both leader and member account', async () => {
    expect(NORMAL_WAVE_DELAY_MS / TICK_MS).toBe(12);
    const leader = await player('waveleader', 'Wave Leader');
    const member = await player('wavemember', 'Wave Member');
    expect(leader.accountId).not.toBe(member.accountId);
    await formMultiplayerParty(leader, member);

    // These are the real HuntSessions created by the Multiplayer Party endpoint,
    // one owned by the leader account and one owned by the invited member account.
    const leaderSession = waveTwoBoundarySession(leader.id);
    const memberSession = waveTwoBoundarySession(member.id);

    // 11 ticks / 2.75s: neither side of the multiplayer party may spawn early.
    settle(leaderSession, START, START + NORMAL_WAVE_DELAY_MS - TICK_MS);
    settle(memberSession, START, START + NORMAL_WAVE_DELAY_MS - TICK_MS);
    expect(leaderSession.active).toHaveLength(0);
    expect(memberSession.active).toHaveLength(0);

    // Tick 12 / 3.00s: leader and the separate member account both open wave 2.
    // A shortage of calibrated spawn credits must not extend the empty screen.
    settle(leaderSession, START + NORMAL_WAVE_DELAY_MS - TICK_MS, START + NORMAL_WAVE_DELAY_MS);
    settle(memberSession, START + NORMAL_WAVE_DELAY_MS - TICK_MS, START + NORMAL_WAVE_DELAY_MS);
    expect(leaderSession.active.length).toBeGreaterThan(0);
    expect(memberSession.active.length).toBeGreaterThan(0);
  });
});
