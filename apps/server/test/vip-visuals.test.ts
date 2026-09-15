import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import { activeVipVisuals } from '../src/vip-visuals.js';

let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  context = await createApp({ databaseFile: ':memory:' });
});

afterEach(async () => {
  await context.app.close();
});

async function makeCharacter(username: string, name: string): Promise<number> {
  const registered = await context.app.inject({
    method: 'POST',
    url: '/api/register',
    payload: { username, password: 'hunter2hunter2' },
  });
  expect(registered.statusCode, registered.body).toBe(200);
  const headers = { authorization: `Bearer ${registered.json().token}` };
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/characters',
    headers,
    payload: { name, vocationId: 4 },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().character.id as number;
}

describe('VIP visual identities', () => {
  it('returns only characters whose VIP is currently active', async () => {
    const vipId = await makeCharacter('vipvisualone', 'Golden Hero');
    const normalId = await makeCharacter('vipvisualtwo', 'Normal Hero');
    const now = Date.now();

    const vipRow = context.db.findCharacter(vipId)!;
    const vipState = JSON.parse(vipRow.state) as CharacterState;
    vipState.premium = true;
    vipState.vipUntil = now + 60_000;
    context.db.saveCharacter(vipId, JSON.stringify(vipState), null, vipRow.settledAt);

    const normalRow = context.db.findCharacter(normalId)!;
    const normalState = JSON.parse(normalRow.state) as CharacterState;
    normalState.premium = true;
    normalState.vipUntil = now - 1;
    context.db.saveCharacter(normalId, JSON.stringify(normalState), null, normalRow.settledAt);

    expect(activeVipVisuals(context.db, now)).toEqual([
      { id: vipId, name: 'Golden Hero' },
    ]);

    const response = await context.app.inject({ method: 'GET', url: '/api/vip-visuals' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().players).toEqual([
      { id: vipId, name: 'Golden Hero' },
    ]);
  });

  it('reads VIP from the live hunt session so the glow stays current while hunting', async () => {
    const id = await makeCharacter('vipvisualhunt', 'Hunting Gold');
    const row = context.db.findCharacter(id)!;
    const state = JSON.parse(row.state) as CharacterState;
    state.premium = false;
    state.vipUntil = 0;

    const session = {
      character: {
        ...state,
        premium: true,
        vipUntil: Date.now() + 60_000,
      },
    } as HuntSession;

    context.db.saveCharacter(id, JSON.stringify(state), JSON.stringify(session), row.settledAt);
    expect(activeVipVisuals(context.db)).toEqual([
      { id, name: 'Hunting Gold' },
    ]);
  });
});
