import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  TICK_MS,
  advance,
  defaultSupplies,
  startSession,
  type CharacterState,
  type HuntSession,
} from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { settle } from '../src/settle.js';

const HUNT_ID = 'venore-rotworm-cave';
const HOUR_MS = 60 * 60 * 1000;
const TICKS_PER_HOUR = Math.floor(HOUR_MS / TICK_MS);

let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  ({ app, db } = await createApp({ databaseFile: ':memory:' }));
});

afterEach(async () => {
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

async function createFreshKnight(username: string, name: string) {
  const registered = await post('/api/register', { username, password: 'hunter2hunter2' });
  expect(registered.statusCode, registered.body).toBe(200);
  const token = registered.json().token as string;
  const created = await post('/api/characters', { name, vocationId: 4, weapon: 'sword' }, token);
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().character.id as number;
  const row = db.findCharacter(id)!;
  return JSON.parse(row.state) as CharacterState;
}

function makeSession(base: CharacterState, vip: boolean, seed: bigint) {
  const character = structuredClone(base);
  character.premium = vip;
  character.vipUntil = vip ? Date.now() + 30 * 24 * HOUR_MS : 0;
  character.supplies = defaultSupplies(character, 24);
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.fleeAt = 0;
  const session = startSession(character, HUNT_ID, seed);
  session.startedAt = Date.now();
  return session;
}

function snapshot(session: HuntSession) {
  return {
    level: session.character.level,
    experienceGained: session.totals.experience,
    experienceTotal: session.character.experience,
    kills: session.totals.kills,
    lootValue: session.totals.lootValue,
    supplyValue: session.totals.supplyValue,
    staminaMinutes: session.character.stamina,
    swordLevel: session.character.skills.sword.level,
    swordTries: session.character.skills.sword.tries,
    status: session.status,
  };
}

describe('fresh VIP progression diagnostic', () => {
  it('starts both simulations from untouched production-created level 8 Knights', async () => {
    const freshFree = await createFreshKnight('freshfree', 'Fresh Free');
    const freshVip = await createFreshKnight('freshvip', 'Fresh Vip');

    // Verify the two production-created characters are equivalent before VIP is applied.
    expect(freshFree.level).toBe(8);
    expect(freshVip.level).toBe(8);
    expect(freshFree.experience).toBe(freshVip.experience);
    expect(freshFree.stamina).toBe(freshVip.stamina);
    expect(freshFree.skills.sword).toEqual(freshVip.skills.sword);
    expect(freshFree.equipment).toEqual(freshVip.equipment);
    expect(freshFree.gold).toBe(freshVip.gold);

    const free = makeSession(freshFree, false, 909090n);
    const vip = makeSession(freshVip, true, 909090n);
    const continuous: Record<string, { free: ReturnType<typeof snapshot>; vip: ReturnType<typeof snapshot> }> = {};
    let elapsed = 0;
    for (const target of [1, 8, 24]) {
      const step = target - elapsed;
      advance(free, TICKS_PER_HOUR * step, { maxEvents: 0 });
      advance(vip, TICKS_PER_HOUR * step, { maxEvents: 0 });
      continuous[`${target}h`] = { free: snapshot(free), vip: snapshot(vip) };
      elapsed = target;
    }

    const freeOffline = makeSession(freshFree, false, 808080n);
    const vipOffline = makeSession(freshVip, true, 808080n);
    const now = Date.now();
    const freeSettlement = settle(freeOffline, now - 24 * HOUR_MS, now, { offline: true });
    const vipSettlement = settle(vipOffline, now - 24 * HOUR_MS, now, { offline: true });

    const offline24h = {
      free: {
        capHours: freeSettlement.capHours,
        appliedHours: freeSettlement.elapsedSeconds / 3600,
        discardedHours: freeSettlement.discardedSeconds / 3600,
        efficiency: freeSettlement.efficiency,
        ...snapshot(freeOffline),
      },
      vip: {
        capHours: vipSettlement.capHours,
        appliedHours: vipSettlement.elapsedSeconds / 3600,
        discardedHours: vipSettlement.discardedSeconds / 3600,
        efficiency: vipSettlement.efficiency,
        ...snapshot(vipOffline),
      },
    };

    console.log('VIP_FRESH_PROGRESSION_DIAGNOSTIC ' + JSON.stringify({
      initial: {
        level: freshFree.level,
        experience: freshFree.experience,
        gold: freshFree.gold,
        staminaMinutes: freshFree.stamina,
        swordLevel: freshFree.skills.sword.level,
      },
      continuous,
      offline24h,
    }));

    expect(continuous['1h']!.vip.experienceGained).toBeGreaterThan(continuous['1h']!.free.experienceGained);
    expect(freeSettlement.capHours).toBe(8);
    expect(vipSettlement.capHours).toBe(24);
  }, 60_000);
});
