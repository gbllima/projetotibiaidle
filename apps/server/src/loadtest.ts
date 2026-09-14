import { fileURLToPath } from 'node:url';
import { expForLevel, TICK_MS, type CharacterState } from '@tibia-idle/sim';
import { createApp } from './app.js';
import { setHuntCap } from './queue.js';

export interface LoadReport {
  hunters: number;
  minutes: number;
  elapsedMs: number;
  ticks: number;
  kills: number;
  gold: number;
  settleMs: number;
}

/**
 * Stresses settlement: many hunters, one long offline window, one read each.
 * This is the hot path when a laptop farm reconnects after a night.
 *
 * The fixture deliberately uses durable level-100 knights in the safe starter
 * cave. This benchmark is about settlement throughput/determinism, not whether
 * a brand-new level-8 character happens to flee or run out of supplies while
 * balance numbers evolve.
 */
export async function runLoad(options: { hunters?: number; minutes?: number } = {}): Promise<LoadReport> {
  const hunters = Math.max(1, options.hunters ?? 40);
  const minutes = Math.max(1, options.minutes ?? 10);
  setHuntCap(hunters);
  const { app, db } = await createApp({ databaseFile: ':memory:' });

  const started = Date.now();
  const tokens: string[] = [];
  const ids: number[] = [];

  for (let i = 0; i < hunters; i += 1) {
    const register = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: `load${i}`, password: 'hunter2hunter2' },
    });
    const token = (register.json() as { token: string }).token;
    tokens.push(token);
    const created = await app.inject({
      method: 'POST',
      url: '/api/characters',
      payload: { name: `Load${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`, vocationId: 4 },
      headers: { authorization: `Bearer ${token}` },
    });
    if (created.statusCode !== 201) {
      throw new Error(`character ${i}: ${created.statusCode} ${created.body}`);
    }
    const id = (created.json() as { character: { id: number } }).character.id;
    ids.push(id);

    // Isolate server settlement performance from beginner survivability. Keep
    // XP/level coherent so level-up calculations remain deterministic.
    const row = db.findCharacter(id)!;
    const state = JSON.parse(row.state) as CharacterState;
    state.level = 100;
    state.experience = expForLevel(100);
    state.gold = 1_000_000;
    state.skills.sword = { level: 70, tries: 0 };
    state.policy.fleeAt = 0;
    state.policy.stopWhenOutOfSupplies = false;
    db.saveCharacter(row.id, JSON.stringify(state), null, row.settledAt);
  }

  const hunts = (await app.inject({
    method: 'GET',
    url: `/api/characters/${ids[0]}/hunts`,
    headers: { authorization: `Bearer ${tokens[0]}` },
  })).json().hunts as Array<{ id: string; unlocked: boolean }>;
  const starter = hunts.find((hunt) => hunt.id === 'venore-rotworm-cave' && hunt.unlocked)
    ?? hunts.find((hunt) => hunt.unlocked);
  if (!starter) throw new Error('load test has no unlocked hunt');
  const huntId = starter.id;

  for (let i = 0; i < hunters; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/characters/${ids[i]}/hunt`,
      payload: { huntId },
      headers: { authorization: `Bearer ${tokens[i]}` },
    });
    if (response.statusCode !== 200) {
      throw new Error(`hunt ${i}: ${response.statusCode} ${response.body}`);
    }
    const row = db.findCharacter(ids[i]!)!;
    db.saveCharacter(row.id, row.state, row.session, Date.now() - minutes * 60 * 1000);
  }

  const settleStart = Date.now();
  let ticks = 0;
  let kills = 0;
  let gold = 0;
  for (let i = 0; i < hunters; i += 1) {
    const after = await app.inject({
      method: 'GET',
      url: `/api/characters/${ids[i]}`,
      headers: { authorization: `Bearer ${tokens[i]}` },
    });
    const session = (after.json() as { character: { session: { totals: { ticks: number; kills: number } } | null; gold: number } }).character;
    ticks += session.session?.totals.ticks ?? 0;
    kills += session.session?.totals.kills ?? 0;
    gold += session.gold;
  }
  const settleMs = Date.now() - settleStart;
  await app.close();

  return {
    hunters,
    minutes,
    elapsedMs: Date.now() - started,
    ticks,
    kills,
    gold,
    settleMs,
  };
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const hunters = Number(process.env['LOAD_HUNTERS'] ?? 40);
  const minutes = Number(process.env['LOAD_MINUTES'] ?? 10);
  const report = await runLoad({ hunters, minutes });
  const expectedTicks = hunters * Math.floor((minutes * 60 * 1000) / TICK_MS);
  console.log(JSON.stringify({ ...report, expectedTicks }, null, 2));
}
