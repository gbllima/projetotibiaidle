import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CharacterState, HuntSession, SimEvent } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { applyMultiplayerLiveHealing } from '../src/social-live.js';

const HUNT_ID = 'venore-rotworm-cave';
const PARTY_UID_STRIDE = 10_000_000;

type TestAccount = {
  token: string;
  headers: Record<string, string>;
  id: number;
  name: string;
};

type StateMessage = {
  type: 'state';
  character: {
    caveParty?: Array<{ id: number; active?: boolean; multiplayer?: boolean }>;
    partyMonsters?: Array<{ uid: number; health: number; maxHealth: number }>;
    partyEvents?: SimEvent[];
  };
};

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
  await context.app.ready();
});

afterEach(async () => {
  await context.app.close();
});

async function account(username: string, name: string, vocationId = 4): Promise<TestAccount> {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const token = registered.json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name, vocationId },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { token, headers, id: created.json().character.id as number, name };
}

function prepareCharacter(id: number, level = 50): void {
  const row = context.db.findCharacter(id)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.level = level;
  state.gold = 1_000_000;
  context.db.saveCharacter(id, JSON.stringify(state), null, row.settledAt);
}

async function joinParty(leader: TestAccount, guest: TestAccount): Promise<void> {
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

  for (const id of [leader.id, guest.id]) {
    const row = context.db.findCharacter(id)!;
    expect(row.session).not.toBeNull();
    const session = JSON.parse(row.session!) as HuntSession;
    expect(session.status).toBe('active');
    expect(session.huntId).toBe(HUNT_ID);
  }
}

function waitForState(
  socket: Awaited<ReturnType<typeof context.app.injectWS>>,
  predicate: (message: StateMessage) => boolean,
  timeoutMs = 8_000,
): Promise<StateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for multiplayer state.'));
    }, timeoutMs);

    const onMessage = (raw: { toString(): string }) => {
      let parsed: StateMessage;
      try {
        parsed = JSON.parse(raw.toString()) as StateMessage;
      } catch {
        return;
      }
      if (parsed.type !== 'state' || !predicate(parsed)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(parsed);
    };

    socket.on('message', onMessage);
  });
}

describe('live multiplayer party', () => {
  it('puts both accounts in the same hunt and relays the remote player attack over websocket', async () => {
    const leader = await account('liveleader', 'Live Leader');
    const guest = await account('liveguest', 'Live Guest');
    prepareCharacter(leader.id);
    prepareCharacter(guest.id);
    await joinParty(leader, guest);
    await startSharedHunt(leader, guest);

    const leaderSocket = await context.app.injectWS('/ws');
    const guestSocket = await context.app.injectWS('/ws');

    try {
      const leaderInitialPromise = waitForState(leaderSocket, () => true);
      leaderSocket.send(JSON.stringify({ type: 'subscribe', token: leader.token, characterId: leader.id }));
      const leaderInitial = await leaderInitialPromise;

      const guestInitialPromise = waitForState(guestSocket, () => true);
      guestSocket.send(JSON.stringify({ type: 'subscribe', token: guest.token, characterId: guest.id }));
      await guestInitialPromise;

      expect(leaderInitial.character.caveParty).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: leader.id, active: true, multiplayer: true }),
        expect.objectContaining({ id: guest.id, active: true, multiplayer: true }),
      ]));
      expect((leaderInitial.character.partyMonsters ?? []).length).toBeGreaterThan(0);

      // Force a meaningful live interval for the guest. Its next socket push
      // settles these ticks; the leader socket must then replay those authoritative
      // ticks as visual events instead of only receiving the changed monster HP.
      const guestRow = context.db.findCharacter(guest.id)!;
      context.db.saveCharacter(guest.id, guestRow.state, guestRow.session, Date.now() - 10_000);

      const remoteAttackPromise = waitForState(
        leaderSocket,
        (message) => (message.character.partyEvents ?? []).some((event) => (
          event.type === 'player_attack'
          && event.actorId === guest.id
          && event.uid !== undefined
        )),
        10_000,
      );

      // Re-subscribing the guest triggers an immediate authoritative settlement;
      // this does not reset the leader's previous remote-session snapshot.
      guestSocket.send(JSON.stringify({ type: 'subscribe', token: guest.token, characterId: guest.id }));
      const remoteFrame = await remoteAttackPromise;
      const remoteAttack = (remoteFrame.character.partyEvents ?? []).find((event) => (
        event.type === 'player_attack' && event.actorId === guest.id && event.uid !== undefined
      ));

      expect(remoteAttack).toBeTruthy();
      expect(Math.floor((remoteAttack!.uid ?? 0) / PARTY_UID_STRIDE)).toBe(guest.id);
      expect((remoteAttack!.amount ?? 0) > 0 || remoteAttack!.missed || remoteAttack!.blocked).toBe(true);
    } finally {
      leaderSocket.terminate();
      guestSocket.terminate();
    }
  }, 15_000);

  it('lets a druid heal a damaged multiplayer ally with exura sio', async () => {
    const knight = await account('healreceiver', 'Heal Receiver', 4);
    const druid = await account('healprovider', 'Heal Provider', 2);
    prepareCharacter(knight.id, 50);
    prepareCharacter(druid.id, 50);
    await joinParty(knight, druid);
    await startSharedHunt(knight, druid);

    const knightRow = context.db.findCharacter(knight.id)!;
    const knightSession = JSON.parse(knightRow.session!) as HuntSession;
    knightSession.character.health = 1;
    context.db.saveCharacter(knight.id, knightRow.state, JSON.stringify(knightSession), knightRow.settledAt);

    const druidRow = context.db.findCharacter(druid.id)!;
    const druidSession = JSON.parse(druidRow.session!) as HuntSession;
    druidSession.character.policy.disabledSpells = ['__partyheal:on'];
    druidSession.healCooldownTicks = 0;
    context.db.saveCharacter(druid.id, druidRow.state, JSON.stringify(druidSession), druidRow.settledAt);

    const manaBefore = druidSession.character.mana;
    const events = applyMultiplayerLiveHealing(context.db, druid.id, Date.now() + 2_000);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'heal', actorId: druid.id, words: 'exura sio' }),
    ]));

    const healedKnight = JSON.parse(context.db.findCharacter(knight.id)!.session!) as HuntSession;
    const healedDruid = JSON.parse(context.db.findCharacter(druid.id)!.session!) as HuntSession;
    expect(healedKnight.character.health).toBeGreaterThan(1);
    expect(healedDruid.character.mana).toBeLessThan(manaBefore);
  });
});
