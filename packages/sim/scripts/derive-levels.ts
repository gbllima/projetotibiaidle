import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hunts } from '@tibia-idle/data';
import {
  advance, defaultSupplies, expectedExperiencePerHour, referenceCharacter,
  startSession, TICKS_PER_HOUR,
} from '../src/index.js';

/**
 * Bakes a recommended level per hunt per vocation.
 *
 * The `Level` field in hunting_places.json is a minimum, not a recommendation:
 * it lists Kha'labal Terramites Cave, whose 365 hp monsters yield 80k xp/h, as
 * level 8. The game needs a number a player can trust, so we find it the only
 * way that is actually reliable - by playing the zone.
 *
 * A level qualifies when a reference character survives the hour and consumes
 * most of the zone's spawn budget, on every seed tried. Three seeds matter: a
 * single run is noisy enough that a level can pass by luck and then get the
 * player killed, and the recommendation is a promise to the player.
 *
 * The search walks a coarse ladder upward rather than bisecting. Survival is
 * only *roughly* monotonic in level once randomness is involved, and bisection
 * on a predicate that flickers converges on nonsense - which is exactly what an
 * earlier version did, recommending level 1542 for a zone it then failed at.
 *
 * Offline script: `pnpm --filter @tibia-idle/sim derive-levels`.
 */

const PLAYABLE = [4, 3, 1, 2, 9] as const;
const SEEDS = [424242n, 8080n, 20260814n];
const SIM_TICKS = Math.round(TICKS_PER_HOUR / 2);
const XP_TARGET = 0.7;

/** Roughly 1.3x per rung: fine enough to be useful, coarse enough to be fast. */
const LADDER = [
  8, 11, 14, 18, 24, 31, 40, 52, 68, 88, 115, 150, 195, 250,
  325, 420, 545, 700, 900, 1150, 1450, 1800,
];

function qualifies(huntId: string, vocationId: number, level: number, target: number): boolean {
  for (const seed of SEEDS) {
    const character = referenceCharacter(vocationId, level);
    character.supplies = defaultSupplies(character, 4);

    const session = startSession(character, huntId, seed);
    advance(session, SIM_TICKS, { maxEvents: 0 });

    if (session.status === 'died') return false;
    const hours = session.totals.ticks / TICKS_PER_HOUR;
    if (hours <= 0) return false;
    if (session.totals.rawExperience / hours / target < XP_TARGET) return false;
  }
  return true;
}

function search(huntId: string, vocationId: number, target: number): number | null {
  for (const level of LADDER) {
    if (qualifies(huntId, vocationId, level, target)) return level;
  }
  return null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, '../../data/generated/hunt-levels.json');

const started = Date.now();
const result: Record<string, Record<string, number>> = {};
let unreachable = 0;

for (const [index, hunt] of hunts.entries()) {
  const target = expectedExperiencePerHour(hunt.id);
  const perVocation: Record<string, number> = {};

  for (const vocationId of PLAYABLE) {
    const level = search(hunt.id, vocationId, target);
    if (level !== null) perVocation[vocationId] = level;
  }
  if (Object.keys(perVocation).length === 0) unreachable += 1;
  result[hunt.id] = perVocation;

  const levels = Object.values(perVocation);
  const label = levels.length ? String(Math.min(...levels)).padStart(5) : '    -';
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `  [${String(index + 1).padStart(3)}/${hunts.length}] ${label} (stated ${String(hunt.level).padStart(4)})  ` +
    `${hunt.name}   ${elapsed}s`,
  );
}

fs.writeFileSync(outFile, JSON.stringify(result));
console.log(`\nwrote ${path.relative(process.cwd(), outFile)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`${unreachable} hunts unreachable by any vocation up to level ${LADDER[LADDER.length - 1]}`);
