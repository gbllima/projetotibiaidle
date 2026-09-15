import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CharacterState } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { listHunts } from '../src/game.js';
import { markOffline, markOnline } from '../src/presence.js';

let context: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => { context = await createApp({ databaseFile: ':memory:' }); });
afterEach(async () => { await context.app.close(); });

async function account(username: string, names: string[]) {
  const registered = await context.app.inject({ method: 'POST', url: '/api/register', payload: { username, password: 'hunter2hunter2' } });
  expect(registered.statusCode, registered.body).toBe(200);
  const headers = { authorization: `Bearer ${registered.json().token}` };
  const ids: number[] = [];
  for (const name of names) {
    const created = await context.app.inject({ method: 'POST', url: '/api/characters', headers, payload: { name, vocationId: 4 } });
    expect(created.statusCode, created.body).toBe(201);
    ids.push(created.json().character.id as number);
  }
  return { headers, ids };
}

async function becomeFriends(
  sender: { headers: Record<string, string>; ids: number[] },
  receiver: { headers: Record<string, string>; ids: number[] },
  receiverName: string,
) {
  const senderId = sender.ids[0]!;
  const receiverId = receiver.ids[0]!;
  const requested = await context.app.inject({
    method: 'POST',
    url: `/api/social/${senderId}/friend-request`,
    headers: sender.headers,
    payload: { name: receiverName },
  });
  expect(requested.statusCode, requested.body).toBe(200);

  const accepted = await context.app.inject({
    method: 'POST',
    url: `/api/social/${receiverId}/friend-request/accept`,
    headers: receiver.headers,
    payload: { fromId: senderId },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
}

async function joinParty(
  leader: { headers: Record<string, string>; ids: number[] },
  guest: { headers: Record<string, string>; ids: number[] },
  guestName: string,
) {
  const leaderId = leader.ids[0]!;
  const guestId = guest.ids[0]!;
  await becomeFriends(leader, guest, guestName);
  const invited = await context.app.inject({
    method: 'POST', url: `/api/multiplayer-party/${leaderId}/invite`, headers: leader.headers, payload: { name: guestName },
  });
  expect(invited.statusCode, invited.body).toBe(200);
  const accepted = await context.app.inject({ method: 'POST', url: `/api/multiplayer-party/${guestId}/accept`, headers: guest.headers });
  expect(accepted.statusCode, accepted.body).toBe(200);
  return accepted;
}

describe('multiplayer party', () => {
  it('requires an accepted friendship before a party invite can be sent', async () => {
    const first = await account('friendgateone', ['Gate Leader']);
    const second = await account('friendgatetwo', ['Gate Guest']);
    const leaderId = first.ids[0]!;
    const guestId = second.ids[0]!;

    const beforeFriendship = await context.app.inject({
      method: 'POST',
      url: `/api/multiplayer-party/${leaderId}/invite`,
      headers: first.headers,
      payload: { name: 'Gate Guest' },
    });
    expect(beforeFriendship.statusCode).toBe(403);
    expect(beforeFriendship.json().error).toContain('aceitaram sua amizade');

    const requested = await context.app.inject({
      method: 'POST',
      url: `/api/social/${leaderId}/friend-request`,
      headers: first.headers,
      payload: { name: 'Gate Guest' },
    });
    expect(requested.statusCode, requested.body).toBe(200);

    const whilePending = await context.app.inject({
      method: 'POST',
      url: `/api/multiplayer-party/${leaderId}/invite`,
      headers: first.headers,
      payload: { name: 'Gate Guest' },
    });
    expect(whilePending.statusCode).toBe(403);

    const acceptedFriendship = await context.app.inject({
      method: 'POST',
      url: `/api/social/${guestId}/friend-request/accept`,
      headers: second.headers,
      payload: { fromId: leaderId },
    });
    expect(acceptedFriendship.statusCode, acceptedFriendship.body).toBe(200);

    const afterAcceptance = await context.app.inject({
      method: 'POST',
      url: `/api/multiplayer-party/${leaderId}/invite`,
      headers: first.headers,
      payload: { name: 'Gate Guest' },
    });
    expect(afterAcceptance.statusCode, afterAcceptance.body).toBe(200);
  });

  it('keeps exactly one active character per account and restores personal formations on leave', async () => {
    const first = await account('multione', ['Alpha Hero', 'Alpha Druid']);
    const second = await account('multitwo', ['Beta Hero', 'Beta Sorcerer']);
    const [alpha, alphaCompanion] = first.ids;
    const [beta, betaCompanion] = second.ids;

    // Existing same-account formations are intentionally preserved as snapshots,
    // but suspended while the cross-account multiplayer party is active.
    context.db.setWorld(`party:${alpha}`, JSON.stringify([alpha, alphaCompanion]));
    context.db.setWorld(`party:${beta}`, JSON.stringify([beta, betaCompanion]));

    await becomeFriends(first, second, 'Beta Hero');
    const invited = await context.app.inject({
      method: 'POST', url: `/api/multiplayer-party/${alpha}/invite`, headers: first.headers, payload: { name: 'Beta Hero' },
    });
    expect(invited.statusCode, invited.body).toBe(200);

    const pending = await context.app.inject({ url: `/api/multiplayer-party/${beta}`, headers: second.headers });
    expect(pending.json().invite.fromName).toBe('Alpha Hero');

    const accepted = await context.app.inject({ method: 'POST', url: `/api/multiplayer-party/${beta}/accept`, headers: second.headers });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().status.members.map((member: { id: number }) => member.id)).toEqual([alpha, beta]);
    expect(accepted.json().status.minLevel).toBe(8);
    expect(accepted.json().status.xpBonusPercent).toBe(10);

    const alphaView = await context.app.inject({ url: `/api/characters/${alpha}`, headers: first.headers });
    const betaView = await context.app.inject({ url: `/api/characters/${beta}`, headers: second.headers });
    expect(alphaView.json().character.partyMemberIds).toEqual([alpha]);
    expect(betaView.json().character.partyMemberIds).toEqual([beta]);
    expect(accepted.json().status.members.some((member: { id: number }) => member.id === alphaCompanion)).toBe(false);
    expect(accepted.json().status.members.some((member: { id: number }) => member.id === betaCompanion)).toBe(false);

    const left = await context.app.inject({ method: 'POST', url: `/api/multiplayer-party/${beta}/leave`, headers: second.headers });
    expect(left.statusCode, left.body).toBe(200);

    const restoredAlpha = await context.app.inject({ url: `/api/characters/${alpha}`, headers: first.headers });
    const restoredBeta = await context.app.inject({ url: `/api/characters/${beta}`, headers: second.headers });
    expect(restoredAlpha.json().character.partyMemberIds).toEqual([alpha, alphaCompanion]);
    expect(restoredBeta.json().character.partyMemberIds).toEqual([beta, betaCompanion]);
  });

  it('rejects inviting another character from the same account', async () => {
    const owner = await account('multisolo', ['Gamma Hero', 'Gamma Druid']);
    const [hero] = owner.ids;
    const response = await context.app.inject({
      method: 'POST', url: `/api/multiplayer-party/${hero}/invite`, headers: owner.headers, payload: { name: 'Gamma Druid' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('Single Player');
  });

  it('limits shared hunts to content unlocked for the lowest-level member', async () => {
    const high = await account('multihigh', ['High Hero']);
    const low = await account('multilow', ['Low Hero']);
    const highId = high.ids[0]!;
    const lowId = low.ids[0]!;

    const highRow = context.db.findCharacter(highId)!;
    const lowRow = context.db.findCharacter(lowId)!;
    const highState = JSON.parse(highRow.state) as CharacterState;
    const lowState = JSON.parse(lowRow.state) as CharacterState;
    highState.level = 150;
    lowState.level = 80;
    context.db.saveCharacter(highId, JSON.stringify(highState), null, highRow.settledAt);
    context.db.saveCharacter(lowId, JSON.stringify(lowState), null, lowRow.settledAt);

    const accepted = await joinParty(high, low, 'Low Hero');
    expect(accepted.json().status.minLevel).toBe(80);

    const lowAccess = new Set(listHunts(lowState).filter((hunt) => hunt.unlocked).map((hunt) => hunt.id));
    const highOnly = listHunts(highState).find((hunt) => hunt.unlocked && !lowAccess.has(hunt.id));
    expect(highOnly, 'expected at least one hunt between level 80 and 150').toBeTruthy();

    const blocked = await context.app.inject({
      method: 'POST',
      url: `/api/multiplayer-party/${highId}/hunt`,
      headers: high.headers,
      payload: { huntId: highOnly!.id, hours: 1 },
    });
    expect(blocked.statusCode, blocked.body).toBe(422);
    expect(blocked.json().error).toContain('Menor level da party: 80');
  });

  it('tracks friends with online state, level and current activity', async () => {
    const first = await account('friendone', ['Friend Owner']);
    const second = await account('friendtwo', ['Friend Target']);
    const ownerId = first.ids[0]!;
    const targetId = second.ids[0]!;

    await becomeFriends(first, second, 'Friend Target');
    const added = await context.app.inject({ url: `/api/friends/${ownerId}`, headers: first.headers });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json().friends).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: targetId, name: 'Friend Target', level: 8, online: false, activity: 'Offline' }),
    ]));

    markOnline(targetId);
    try {
      const training = await context.app.inject({
        method: 'POST', url: `/api/friends/${targetId}/activity`, headers: second.headers, payload: { activity: 'training' },
      });
      expect(training.statusCode, training.body).toBe(200);

      const online = await context.app.inject({ url: `/api/friends/${ownerId}`, headers: first.headers });
      expect(online.statusCode, online.body).toBe(200);
      expect(online.json().friends[0]).toEqual(expect.objectContaining({
        id: targetId,
        level: 8,
        online: true,
        activity: 'Treino',
      }));
    } finally {
      markOffline(targetId);
    }

    const removed = await context.app.inject({
      method: 'DELETE', url: `/api/social/${ownerId}/friends/${targetId}`, headers: first.headers,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const afterRemoval = await context.app.inject({ url: `/api/friends/${ownerId}`, headers: first.headers });
    expect(afterRemoval.json().friends).toEqual([]);
  });
});
