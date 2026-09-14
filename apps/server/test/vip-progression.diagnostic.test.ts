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

async function get(url: string, token?: string) {
  return app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function del(url: string, token: string) {
  return app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });
}

async function signUp(username: string) {
  const response = await post('/api/register', { username, password: 'hunter2hunter2' });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().token as string;
}

async function makeKnight(token: string, name: string) {
  const response = await post('/api/characters', { name, vocationId: 4, weapon: 'sword' }, token);
  expect(response.statusCode, response.body).toBe(201);
  return response.json().character as { id: number };
}

function activateVipInStoredState(characterId: number, now = Date.now()) {
  const row = db.findCharacter(characterId)!;
  const state = JSON.parse(row.state) as CharacterState;
  state.premium = true;
  state.vipUntil = now + 30 * 24 * HOUR_MS;
  db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

function totalBestiaryKills(character: { bestiary?: Record<string, number> }) {
  return Object.values(character.bestiary ?? {}).reduce((sum, value) => sum + value, 0);
}

function combatSnapshot(session: HuntSession) {
  return {
    level: session.character.level,
    experienceTotal: session.character.experience,
    experienceGained: session.totals.experience,
    kills: session.totals.kills,
    lootValue: session.totals.lootValue,
    supplyValue: session.totals.supplyValue,
    staminaMinutes: session.character.stamina,
    swordLevel: session.character.skills.sword.level,
    swordTries: session.character.skills.sword.tries,
    gold: session.character.gold,
    status: session.status,
  };
}

function preparedContinuousSession(base: CharacterState, vip: boolean, seed = 20260914n) {
  const character = structuredClone(base);
  character.premium = vip;
  character.vipUntil = vip ? Date.now() + 30 * 24 * HOUR_MS : 0;
  // Same generous supply pack for both: this part isolates progression/XP from wallet constraints.
  character.supplies = defaultSupplies(character, 24);
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.fleeAt = 0;
  const session = startSession(character, HUNT_ID, seed);
  session.startedAt = Date.now();
  return session;
}

describe('VIP vs free progression diagnostic', () => {
  it('compares two fresh Knights under identical conditions', async () => {
    const now = Date.now();
    const freeToken = await signUp('diagfree');
    const vipToken = await signUp('diagvip');
    const freeCreated = await makeKnight(freeToken, 'Free Tester');
    const vipCreated = await makeKnight(vipToken, 'Vip Tester');
    activateVipInStoredState(vipCreated.id, now);

    // --- Scenario 1: exact production flow, first 1h trip, real starter gold/supplies. ---
    const freeStart = await post(`/api/characters/${freeCreated.id}/hunt`, { huntId: HUNT_ID, hours: 1 }, freeToken);
    const vipStart = await post(`/api/characters/${vipCreated.id}/hunt`, { huntId: HUNT_ID, hours: 1 }, vipToken);
    expect(freeStart.statusCode, freeStart.body).toBe(200);
    expect(vipStart.statusCode, vipStart.body).toBe(200);

    const freeRowStarted = db.findCharacter(freeCreated.id)!;
    const vipRowStarted = db.findCharacter(vipCreated.id)!;
    const freeSession = JSON.parse(freeRowStarted.session!) as HuntSession;
    const vipOwnSession = JSON.parse(vipRowStarted.session!) as HuntSession;

    // Make combat RNG/monster state identical; only the embedded character keeps VIP differences.
    const syncedVipSession = structuredClone(freeSession);
    syncedVipSession.character = vipOwnSession.character;
    syncedVipSession.character.premium = true;
    syncedVipSession.character.vipUntil = now + 30 * 24 * HOUR_MS;

    const oneHourAgo = Date.now() - HOUR_MS;
    freeSession.startedAt = oneHourAgo;
    syncedVipSession.startedAt = oneHourAgo;
    db.saveCharacter(freeCreated.id, freeRowStarted.state, JSON.stringify(freeSession), oneHourAgo);
    db.saveCharacter(vipCreated.id, vipRowStarted.state, JSON.stringify(syncedVipSession), oneHourAgo);

    const freeAfterResponse = await get(`/api/characters/${freeCreated.id}`, freeToken);
    const vipAfterResponse = await get(`/api/characters/${vipCreated.id}`, vipToken);
    expect(freeAfterResponse.statusCode).toBe(200);
    expect(vipAfterResponse.statusCode).toBe(200);
    const freeAfter = freeAfterResponse.json();
    const vipAfter = vipAfterResponse.json();

    if (freeAfter.character.session) await del(`/api/characters/${freeCreated.id}/hunt`, freeToken);
    if (vipAfter.character.session) await del(`/api/characters/${vipCreated.id}/hunt`, vipToken);
    const freeBanked = (await get(`/api/characters/${freeCreated.id}`, freeToken)).json().character;
    const vipBanked = (await get(`/api/characters/${vipCreated.id}`, vipToken)).json().character;

    const productionOneHour = {
      free: {
        level: freeBanked.level,
        experienceTotal: freeBanked.experience,
        experienceGained: freeAfter.settlement.delta.experience,
        kills: totalBestiaryKills(freeBanked),
        gold: freeBanked.gold,
        staminaMinutes: freeBanked.stamina,
        swordLevel: freeBanked.skills.sword.level,
        settlement: freeAfter.settlement,
      },
      vip: {
        level: vipBanked.level,
        experienceTotal: vipBanked.experience,
        experienceGained: vipAfter.settlement.delta.experience,
        kills: totalBestiaryKills(vipBanked),
        gold: vipBanked.gold,
        staminaMinutes: vipBanked.stamina,
        swordLevel: vipBanked.skills.sword.level,
        settlement: vipAfter.settlement,
      },
    };

    // --- Scenario 2: continuous equal-combat comparison at 1h / 8h / 24h. ---
    // Fresh production-created states, same gear and same RNG. Supplies are normalized so only VIP mechanics differ.
    const freeInitialState = JSON.parse(db.findCharacter(freeCreated.id)!.state) as CharacterState;
    const normalizedBase = structuredClone(freeInitialState);
    normalizedBase.level = 8;
    normalizedBase.experience = 4200; // createCharacter's level-8 baseline; both start from the same production level.
    normalizedBase.bestiary = {};
    normalizedBase.premium = false;
    normalizedBase.vipUntil = 0;
    normalizedBase.stamina = 42 * 60;
    normalizedBase.skills.sword.level = 12;
    normalizedBase.skills.sword.tries = 0;

    const freeContinuous = preparedContinuousSession(normalizedBase, false);
    const vipContinuous = preparedContinuousSession(normalizedBase, true);
    const continuous: Record<string, { free: ReturnType<typeof combatSnapshot>; vip: ReturnType<typeof combatSnapshot> }> = {};
    let elapsedHours = 0;
    for (const targetHours of [1, 8, 24]) {
      const stepHours = targetHours - elapsedHours;
      advance(freeContinuous, TICKS_PER_HOUR * stepHours, { maxEvents: 0 });
      advance(vipContinuous, TICKS_PER_HOUR * stepHours, { maxEvents: 0 });
      continuous[`${targetHours}h`] = { free: combatSnapshot(freeContinuous), vip: combatSnapshot(vipContinuous) };
      elapsedHours = targetHours;
    }

    // --- Scenario 3: single 24h offline absence with enough supplies to expose the cap. ---
    const offlineBase = structuredClone(normalizedBase);
    const freeOffline = preparedContinuousSession(offlineBase, false, 404n);
    const vipOffline = preparedContinuousSession(offlineBase, true, 404n);
    const settleNow = Date.now();
    const freeOfflineResult = settle(freeOffline, settleNow - 24 * HOUR_MS, settleNow, { offline: true });
    const vipOfflineResult = settle(vipOffline, settleNow - 24 * HOUR_MS, settleNow, { offline: true });
    const offline24h = {
      free: {
        capHours: freeOfflineResult.capHours,
        appliedSeconds: freeOfflineResult.elapsedSeconds,
        discardedSeconds: freeOfflineResult.discardedSeconds,
        efficiency: freeOfflineResult.efficiency,
        ...combatSnapshot(freeOffline),
      },
      vip: {
        capHours: vipOfflineResult.capHours,
        appliedSeconds: vipOfflineResult.elapsedSeconds,
        discardedSeconds: vipOfflineResult.discardedSeconds,
        efficiency: vipOfflineResult.efficiency,
        ...combatSnapshot(vipOffline),
      },
    };

    console.log('VIP_PROGRESSION_DIAGNOSTIC ' + JSON.stringify({ productionOneHour, continuous, offline24h }));

    expect(productionOneHour.vip.experienceGained).toBeGreaterThan(productionOneHour.free.experienceGained);
    expect(continuous['1h']!.vip.experienceGained).toBeGreaterThan(continuous['1h']!.free.experienceGained);
    expect(freeOfflineResult.capHours).toBe(8);
    expect(vipOfflineResult.capHours).toBe(24);
  }, 60_000);
});
