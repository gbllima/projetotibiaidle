import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TICK_MS, WAVE_PACK, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { loadCharacter } from '../src/game.js';

const HUNT_ID = 'amazon-camp';
const START = 1_700_000_000_000;
const NORMAL_WAVE_DELAY_MS = 3_000;

type Player = {
  accountId: number;
  headers: Record<string, string>;
  id: number;
  name: string;
};

type MultiplayerSession = HuntSession & {
  reinforcementWaveIndex?: number;
  reinforcementReadyTick?: number;
  nextWaveAtTick?: number;
  reinforcementPartySize?: number;
  reinforcementPartyIndex?: number;
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

  const leaderSession = JSON.parse(context.db.findCharacter(leader.id)!.session!) as MultiplayerSession;
  const memberSession = JSON.parse(context.db.findCharacter(member.id)!.session!) as MultiplayerSession;
  expect(leaderSession.reinforcementPartySize).toBe(2);
  expect(leaderSession.reinforcementPartyIndex).toBe(0);
  expect(memberSession.reinforcementPartySize).toBe(2);
  expect(memberSession.reinforcementPartyIndex).toBe(1);
}

function persistWaveTwoBoundary(id: number): void {
  const row = context.db.findCharacter(id)!;
  expect(row.session).not.toBeNull();
  const session = JSON.parse(row.session!) as MultiplayerSession;
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

describe('multiplayer wave timing', () => {
  it('spawns the next Amazon Camp wave at 3s for both accounts and shares the visible cap', async () => {
    expect(NORMAL_WAVE_DELAY_MS / TICK_MS).toBe(12);
    const leader = await player('waveleader', 'Wave Leader');
    const member = await player('wavemember', 'Wave Member');
    expect(leader.accountId).not.toBe(member.accountId);
    await formMultiplayerParty(leader, member);

    // Use the real HuntSessions created by the Multiplayer Party endpoint: one
    // belongs to the leader account and one to the invited member account.
    persistWaveTwoBoundary(leader.id);
    persistWaveTwoBoundary(member.id);

    // 11 ticks / 2.75s: the live character load must still show an empty floor.
    const earlyLeader = loadCharacter(
      context.db, leader.accountId, leader.id, START + NORMAL_WAVE_DELAY_MS - TICK_MS,
    ).loaded.session!;
    const earlyMember = loadCharacter(
      context.db, member.accountId, member.id, START + NORMAL_WAVE_DELAY_MS - TICK_MS,
    ).loaded.session!;
    expect(earlyLeader.active).toHaveLength(0);
    expect(earlyMember.active).toHaveLength(0);

    // Tick 12 / 3.00s: both accounts open wave 2. Wave 2 has a global visible
    // cap of four, so a two-account party receives two enemies per session —
    // four on the merged map, never four per account.
    const onTimeLeader = loadCharacter(
      context.db, leader.accountId, leader.id, START + NORMAL_WAVE_DELAY_MS,
    ).loaded.session!;
    const onTimeMember = loadCharacter(
      context.db, member.accountId, member.id, START + NORMAL_WAVE_DELAY_MS,
    ).loaded.session!;
    expect(onTimeLeader.active).toHaveLength(2);
    expect(onTimeMember.active).toHaveLength(2);
    expect(onTimeLeader.active.length + onTimeMember.active.length).toBe(4);
  });
});
