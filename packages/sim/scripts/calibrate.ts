import { calibratedLevelFor, hunts, type Hunt } from '@tibia-idle/data';
import {
  advance, defaultSupplies, expectedExperiencePerHour, hourlyRates,
  huntThroughput, referenceCharacter, startSession, TICKS_PER_HOUR,
  type SessionStatus,
} from '../src/index.js';

/**
 * Calibration sweep across every hunting zone.
 *
 * Each zone is played by a reference character at its *derived* recommended
 * level (see scripts/derive-levels.ts), not the `Level` field in the source
 * data, which is a minimum and puts an 80k xp/h zone at level 8.
 *
 * The comparison uses raw experience, before server rate stages, because the
 * official Xp/Hour figures are 1x numbers while data/stages.lua multiplies by
 * up to 7 at low level.
 *
 * A healthy result is a median ratio near 1.0, few deaths, and profitable
 * economics at the recommended level.
 */

const PLAYABLE = [4, 3, 1, 2, 9] as const;

interface Row {
  hunt: Hunt;
  vocationId: number;
  level: number;
  ratio: number;
  simulated: number;
  target: number;
  status: SessionStatus;
  kills: number;
  profit: number;
}

function bestVocation(hunt: Hunt): { vocationId: number; level: number } | null {
  let best: { vocationId: number; level: number } | null = null;
  for (const vocationId of PLAYABLE) {
    const level = calibratedLevelFor(hunt.id, vocationId);
    if (level === null) continue;
    if (!best || level < best.level) best = { vocationId, level };
  }
  return best;
}

const rows: Row[] = [];
const unreachable: string[] = [];

for (const hunt of hunts) {
  const choice = bestVocation(hunt);
  if (!choice) { unreachable.push(hunt.name); continue; }

  const character = referenceCharacter(choice.vocationId, choice.level);
  character.supplies = defaultSupplies(character, 4);

  const session = startSession(character, hunt.id, 987654321n);
  advance(session, TICKS_PER_HOUR, { maxEvents: 0 });

  const hours = session.totals.ticks / TICKS_PER_HOUR;
  const rawPerHour = hours > 0 ? session.totals.rawExperience / hours : 0;
  const target = expectedExperiencePerHour(hunt.id);

  rows.push({
    hunt,
    vocationId: choice.vocationId,
    level: choice.level,
    ratio: target > 0 ? rawPerHour / target : 0,
    simulated: Math.round(rawPerHour),
    target,
    status: session.status,
    kills: session.totals.kills,
    profit: hourlyRates(session).profitPerHour,
  });
}

rows.sort((a, b) => a.ratio - b.ratio);

const ratios = rows.map((r) => r.ratio);
const quantile = (q: number): number => ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] ?? 0;
const within = (lo: number, hi: number): number => rows.filter((r) => r.ratio >= lo && r.ratio <= hi).length;

const byStatus = new Map<SessionStatus, number>();
for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);

console.log(`\nCalibration: ${rows.length} hunts at their derived recommended level`);
console.log(`${unreachable.length} unreachable by any vocation\n`);

console.log('  raw xp/h vs expected');
for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
  console.log(`    p${String(q * 100).padStart(2)}   ${quantile(q).toFixed(2)}x`);
}
console.log(`    within 0.7-1.3x  ${within(0.7, 1.3)} / ${rows.length}`);
console.log(`    within 0.5-1.5x  ${within(0.5, 1.5)} / ${rows.length}`);

console.log('\n  session outcomes after one hour');
for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${status.padEnd(18)} ${count}`);
}

const profitable = rows.filter((r) => r.profit > 0).length;
console.log(`\n  profitable at the recommended level: ${profitable} / ${rows.length}`);

const show = (row: Row): string =>
  `    ${row.hunt.name.slice(0, 30).padEnd(31)} lv${String(row.level).padStart(5)} voc${row.vocationId} ` +
  `${row.ratio.toFixed(2).padStart(6)}x ${row.simulated.toLocaleString().padStart(11)} vs ` +
  `${row.target.toLocaleString().padStart(11)}  ${row.status.padEnd(16)} k=${row.kills}`;

console.log('\n  lowest 10 ratios');
for (const row of rows.slice(0, 10)) console.log(show(row));

console.log('\n  highest 10 ratios');
for (const row of rows.slice(-10).reverse()) console.log(show(row));

console.log('\n  pack size distribution');
const packs = new Map<number, number>();
for (const hunt of hunts) {
  const size = huntThroughput(hunt.id).packSize;
  packs.set(size, (packs.get(size) ?? 0) + 1);
}
for (const [size, count] of [...packs].sort((a, b) => a[0] - b[0])) {
  console.log(`    ${size} monsters  ${'#'.repeat(count)} ${count}`);
}
