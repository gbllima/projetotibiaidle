import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TICK_MS,
  deriveStats,
  waveProgress,
  type CharacterState,
  type HuntSession,
} from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { loadCharacter } from '../src/game.js';
import { decorateMultiplayerCharacter } from '../src/social-live.js';
import { applyMultiplayerLiveHealing } from '../src/social-live.js';

type MultiplayerSession = HuntSession & {
  multiplayerDown?: boolean;
  multiplayerDownAtWave?: number;
  multiplayerLastSharedWave?: number;
  reinforcementPartySize?: number;
};

type TestAccount = {
  accountId: number;
  token: string;
  headers: Record<string, string>;
  id: number;
  name: string;
};

const HUNT_ID = 'amazon-camp';
let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
  await context.app.ready();
});

afterEach(async () => {
  await context.app.close();
});

async function account(username: string, name: string): Promise<TestAccount> {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const body = registered.json() as { token: string; account?: { id?: number } };
  const token = body.token;
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
  return { accountId: row.accountId, token, headers, id, name };
}

function prepareCharacter(id: number): void {
  const row = context.db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.level = 50;
  state.gold = 1_000_000;
  state.policy.stopWhenOutOfSupplies = false;
  state.policy.fleeAt = 0;
  context.db.saveCharacter(id, JSON.stringify(state), null, row.settledAt);
}

async function formParty(leader: TestAccount, member: TestAccount): Promise<void> {
  const requested = await context.app.inject({
    method: 'POST', url: `/api/social/${leader.id}/friend-request`, headers: leader.headers,
    payload: { name: member.name },
  });
  expect(requested.statusCode, requested.body).toBe(200);
  const befriended = await context.app.inject({
    method: 'POST', url: `/api/social/${member.id}/friend-request/accept`, headers: member.headers,
    payload: { fromId: leader.id },
  });
  expect(befriended.statusCode, befriended.body).toBe(200);
  const invited = await context.app.inject({
    method: 'POST', url: `/api/multiplayer-party/${leader.id}/invite`, headers: leader.headers,
    payload: { name: member.name },
  });
  expect(invited.statusCode, invited.body).toBe(200);
  const accepted = await context.app.inject({
    method: 'POST', url: `/api/multiplayer-party/${member.id}/accept`, headers: member.headers,
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const started = await context.app.inject({
    method: 'POST', url: `/api/multiplayer-party/${leader.id}/hunt`, headers: leader.headers,
    payload: { huntId: HUNT_ID, hours: 1 },
  });
  expect(started.statusCode, started.body).toBe(200);
}

function sessionOf(id: number): MultiplayerSession {
  const row = context.db.findCharacter(id)!;
  expect(row.session).not.toBeNull();
  return JSON.parse(row.session!) as MultiplayerSession;
}

describe('multiplayer death between waves', () => {
  it('keeps the corpse down for the current wave and revives it only when the next shared wave starts', async () => {
    const leader = await account('reviveleader', 'Revive Leader');
    const member = await account('revivemember', 'Revive Member');
    prepareCharacter(leader.id);
    prepareCharacter(member.id);
    await formParty(leader, member);

    const memberRow = context.db.findCharacter(member.id)!;
    const doomed = JSON.parse(memberRow.session!) as MultiplayerSession;
    expect(doomed.reinforcementPartySize).toBe(2);
    // The shared wave layout, not the social XP marker, must keep a real party
    // member in the cave. This reproduces live sessions where boostedMonsterId
    // is absent/replaced but the multiplayer hunt itself is still active.
    doomed.boostedMonsterId = undefined;
    // Zero HP reaches the simulator's real death branch without triggering the
    // negative-HP flee check first.
    doomed.character.health = 0;
    doomed.character.policy.healthPotionId = -1;
    doomed.character.policy.manaPotionId = -1;
    doomed.character.policy.spiritPotionId = -1;
    doomed.character.policy.healSpellId = '';
    doomed.character.policy.fleeAt = 0;
    doomed.character.policy.stopWhenOutOfSupplies = false;
    const deathNow = Date.now();
    context.db.saveCharacter(member.id, memberRow.state, JSON.stringify(doomed), deathNow - 4 * TICK_MS);

    const death = loadCharacter(context.db, member.accountId, member.id, deathNow);
    expect(death.settlement.stoppedBecause).toBeNull();
    expect(death.loaded.session).not.toBeNull();
    expect((death.loaded.session as MultiplayerSession).multiplayerDown).toBe(true);
    expect(death.loaded.session!.status).toBe('active');
    expect(death.loaded.session!.character.health).toBe(0);
    expect(death.loaded.session!.active).toHaveLength(0);

    const downView = decorateMultiplayerCharacter(context.db, leader.id, { caveParty: [] as unknown[] });
    const corpse = (downView.caveParty as Array<{
      id: number; active?: boolean; diedInHunt?: boolean; health?: number; mana?: number;
    }>).find((entry) => entry.id === member.id);
    expect(corpse).toMatchObject({ id: member.id, active: false, diedInHunt: true, health: 0, mana: 0 });

    const downSession = sessionOf(member.id);
    const downTick = downSession.tick;
    const downKills = downSession.totals.kills;
    const downExperience = downSession.totals.experience;
    expect(downSession.multiplayerDownAtWave).toBeDefined();

    // While the same wave is still running, the fallen account is frozen: it
    // cannot fight, gain XP/loot, or be healed by exura sio.
    loadCharacter(context.db, member.accountId, member.id, deathNow + 5_000);
    const stillDown = sessionOf(member.id);
    expect(stillDown.multiplayerDown).toBe(true);
    expect(stillDown.tick).toBe(downTick);
    expect(stillDown.totals.kills).toBe(downKills);
    expect(stillDown.totals.experience).toBe(downExperience);
    expect(applyMultiplayerLiveHealing(context.db, leader.id, deathNow + 5_000)).toEqual([]);

    // Complete exactly the remainder of the shared wave using the surviving
    // member. The next presentation frame is the authoritative revive point.
    const leaderRow = context.db.findCharacter(leader.id)!;
    const leaderSession = JSON.parse(leaderRow.session!) as MultiplayerSession;
    const sharedKills = leaderSession.totals.kills + stillDown.totals.kills;
    const progress = waveProgress(sharedKills);
    leaderSession.totals.kills += progress.size - progress.killed;
    context.db.saveCharacter(leader.id, leaderRow.state, JSON.stringify(leaderSession), leaderRow.settledAt);

    decorateMultiplayerCharacter(context.db, leader.id, { caveParty: [] as unknown[] });
    const revived = sessionOf(member.id);
    const stats = deriveStats(revived.character);
    expect(revived.multiplayerDown).toBe(false);
    expect(revived.status).toBe('active');
    expect(revived.character.health).toBe(Math.max(1, Math.round(stats.maxHealth * 0.5)));
    expect(revived.character.mana).toBe(Math.max(0, Math.round(stats.maxMana * 0.5)));

    const revivedView = decorateMultiplayerCharacter(context.db, leader.id, { caveParty: [] as unknown[] });
    const livingMember = (revivedView.caveParty as Array<{
      id: number; active?: boolean; diedInHunt?: boolean; health?: number;
    }>).find((entry) => entry.id === member.id);
    expect(livingMember?.active).toBe(true);
    expect(livingMember?.diedInHunt).toBe(false);
    expect((livingMember?.health ?? 0)).toBeGreaterThan(0);
  });
});
