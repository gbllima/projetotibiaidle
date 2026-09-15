import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

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

describe('multiplayer party', () => {
  it('keeps exactly one active character per account and restores personal formations on leave', async () => {
    const first = await account('multione', ['Alpha Hero', 'Alpha Druid']);
    const second = await account('multitwo', ['Beta Hero', 'Beta Sorcerer']);
    const [alpha, alphaCompanion] = first.ids;
    const [beta, betaCompanion] = second.ids;

    // Existing same-account formations are intentionally preserved as snapshots,
    // but suspended while the cross-account multiplayer party is active.
    context.db.setWorld(`party:${alpha}`, JSON.stringify([alpha, alphaCompanion]));
    context.db.setWorld(`party:${beta}`, JSON.stringify([beta, betaCompanion]));

    const invited = await context.app.inject({
      method: 'POST', url: `/api/multiplayer-party/${alpha}/invite`, headers: first.headers, payload: { name: 'Beta Hero' },
    });
    expect(invited.statusCode, invited.body).toBe(200);

    const pending = await context.app.inject({ url: `/api/multiplayer-party/${beta}`, headers: second.headers });
    expect(pending.json().invite.fromName).toBe('Alpha Hero');

    const accepted = await context.app.inject({ method: 'POST', url: `/api/multiplayer-party/${beta}/accept`, headers: second.headers });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().status.members.map((member: { id: number }) => member.id)).toEqual([alpha, beta]);

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
});
