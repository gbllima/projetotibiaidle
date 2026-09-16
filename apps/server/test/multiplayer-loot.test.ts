import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemsByName } from '@tibia-idle/data';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { captureMultiplayerLootBaseline, redistributeMultiplayerLoot } from '../src/multiplayer-loot.js';

const HUNT_ID = 'venore-rotworm-cave';
const ITEM_ID = itemsByName.get('arrow')!.id;

type TestAccount = {
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

async function account(username: string, name: string): Promise<TestAccount> {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const headers = { authorization: `Bearer ${registered.json().token as string}` };
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name, vocationId: 4, weapon: 'sword' },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { headers, id: created.json().character.id as number, name };
}

function prepareCharacter(id: number): void {
  const row = context.db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.level = 50;
  state.gold = 1_000_000;
  context.db.saveCharacter(id, JSON.stringify(state), null, row.settledAt);
}

async function joinParty(leader: TestAccount, guest: TestAccount): Promise<void> {
  const requested = await context.app.inject({
    method: 'POST',
    url: `/api/social/${leader.id}/friend-request`,
    headers: leader.headers,
    payload: { name: guest.name },
  });
  expect(requested.statusCode, requested.body).toBe(200);

  const friended = await context.app.inject({
    method: 'POST',
    url: `/api/social/${guest.id}/friend-request/accept`,
    headers: guest.headers,
    payload: { fromId: leader.id },
  });
  expect(friended.statusCode, friended.body).toBe(200);

  const invited = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${leader.id}/invite`,
    headers: leader.headers,
    payload: { name: guest.name },
  });
  expect(invited.statusCode, invited.body).toBe(200);

  const accepted = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${guest.id}/accept`,
    headers: guest.headers,
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
}

async function startSharedHunt(leader: TestAccount, guest: TestAccount): Promise<void> {
  const started = await context.app.inject({
    method: 'POST',
    url: `/api/multiplayer-party/${leader.id}/hunt`,
    headers: leader.headers,
    payload: { huntId: HUNT_ID, hours: 1 },
  });
  expect(started.statusCode, started.body).toBe(200);
  expect(started.json().memberIds).toEqual([leader.id, guest.id]);
}

describe('multiplayer loot ownership', () => {
  it('moves only newly dropped pouch items from the killer to the selected party member', async () => {
    const leader = await account('lootleader', 'Loot Leader');
    const guest = await account('lootguest', 'Loot Guest');
    prepareCharacter(leader.id);
    prepareCharacter(guest.id);
    await joinParty(leader, guest);
    await startSharedHunt(leader, guest);

    const leaderBefore = context.db.findCharacter(leader.id)!;
    const guestBefore = context.db.findCharacter(guest.id)!;
    const leaderSession = JSON.parse(leaderBefore.session!) as HuntSession;
    const guestSession = JSON.parse(guestBefore.session!) as HuntSession;

    // Existing loot must stay with its current owner. Only the +4 units below
    // represent drops created by the settlement that just finished.
    leaderSession.totals.lootByItem[ITEM_ID] = 3;
    context.db.saveCharacter(leader.id, leaderBefore.state, JSON.stringify(leaderSession), leaderBefore.settledAt);
    const baseline = captureMultiplayerLootBaseline(context.db, leader.id);
    expect(baseline?.lootByItem[ITEM_ID]).toBe(3);

    leaderSession.totals.lootByItem[ITEM_ID] = 7;
    const moved = redistributeMultiplayerLoot(
      context.db,
      leader.id,
      leaderSession,
      baseline,
      () => 1, // [leader, guest] -> deterministically choose guest in this test.
    );

    expect(moved).toBe(4);
    const savedLeader = context.db.findCharacter(leader.id)!;
    const savedGuest = context.db.findCharacter(guest.id)!;
    const savedLeaderSession = JSON.parse(savedLeader.session!) as HuntSession;
    const savedGuestSession = JSON.parse(savedGuest.session!) as HuntSession;

    expect(savedLeaderSession.totals.lootByItem[ITEM_ID]).toBe(3);
    expect(savedGuestSession.totals.lootByItem[ITEM_ID]).toBe((guestSession.totals.lootByItem[ITEM_ID] ?? 0) + 4);
    expect(savedLeader.settledAt).toBe(leaderBefore.settledAt);
    expect(savedGuest.settledAt).toBe(guestBefore.settledAt);
  });

  it('does not award new loot to a dead multiplayer member', async () => {
    const leader = await account('lootliveleader', 'Loot Live Leader');
    const guest = await account('lootdeadguest', 'Loot Dead Guest');
    prepareCharacter(leader.id);
    prepareCharacter(guest.id);
    await joinParty(leader, guest);
    await startSharedHunt(leader, guest);

    const leaderRow = context.db.findCharacter(leader.id)!;
    const guestRow = context.db.findCharacter(guest.id)!;
    const leaderSession = JSON.parse(leaderRow.session!) as HuntSession;
    const guestSession = JSON.parse(guestRow.session!) as HuntSession;
    guestSession.character.health = 0;
    context.db.saveCharacter(guest.id, guestRow.state, JSON.stringify(guestSession), guestRow.settledAt);

    const baseline = captureMultiplayerLootBaseline(context.db, leader.id)!;
    leaderSession.totals.lootByItem[ITEM_ID] = (baseline.lootByItem[ITEM_ID] ?? 0) + 2;
    const moved = redistributeMultiplayerLoot(context.db, leader.id, leaderSession, baseline, () => 1);

    expect(moved).toBe(0);
    expect(leaderSession.totals.lootByItem[ITEM_ID]).toBe((baseline.lootByItem[ITEM_ID] ?? 0) + 2);
  });
});
