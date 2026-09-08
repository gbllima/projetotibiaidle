import { hunts, itemsById } from '@tibia-idle/data';
import {
  advance, defaultSupplies, deriveStats, hourlyRates,
  referenceCharacter, startSession, TICKS_PER_HOUR,
} from '../src/index.js';

/**
 * One simulated hour per archetype, printed next to the official rates.
 *
 * This is the fast feedback loop while tuning combat; `calibrate.ts` is the
 * exhaustive version that sweeps all 131 hunts.
 */

const sorted = [...hunts].sort((a, b) => a.level - b.level);
const pick = (level: number) =>
  sorted.reduce((best, hunt) =>
    Math.abs(hunt.level - level) < Math.abs(best.level - level) ? hunt : best,
  );

const CASES = [
  { label: 'Knight', vocationId: 4, level: 25 },
  { label: 'Paladin', vocationId: 3, level: 60 },
  { label: 'Sorcerer', vocationId: 1, level: 120 },
  { label: 'Druid', vocationId: 2, level: 250 },
];

for (const testCase of CASES) {
  const hunt = pick(testCase.level);
  const character = referenceCharacter(testCase.vocationId, testCase.level);
  character.supplies = defaultSupplies(character, 2);

  const stats = deriveStats(character);
  const session = startSession(character, hunt.id, 12345n);
  advance(session, TICKS_PER_HOUR, { maxEvents: 0 });
  const rates = hourlyRates(session);

  const gear = Object.entries(character.equipment)
    .map(([slot, id]) => `${slot}=${itemsById.get(id as number)?.name ?? '?'}`)
    .join(', ');

  const ratio = hunt.expectedXpPerHour > 0 ? rates.xpPerHour / hunt.expectedXpPerHour : 0;

  console.log(`\n${testCase.label} ${testCase.level} -> ${hunt.name} (level ${hunt.level})`);
  console.log(`  gear       ${gear || '(none)'}`);
  console.log(`  offense    atk=${stats.attackValue} skill=${stats.attackSkill} (${stats.attackSkillName}) ml=${character.magicLevel}`);
  console.log(`  defense    def=${stats.defense.toFixed(0)} armor=${stats.armor} mit=${stats.mitigation}%`);
  console.log(`  pools      ${stats.maxHealth} hp / ${stats.maxMana} mp`);
  console.log(`  outcome    ${session.status}, ${session.totals.kills} kills, ${session.totals.deaths} deaths`);
  console.log(`  xp/h       ${rates.xpPerHour.toLocaleString()} vs official ${hunt.expectedXpPerHour.toLocaleString()}  (${(ratio * 100).toFixed(0)}%)`);
  console.log(`  loot/h     ${rates.lootPerHour.toLocaleString()} vs official ${hunt.expectedLootPerHour.toLocaleString()}`);
  console.log(`  supplies/h ${rates.suppliesPerHour.toLocaleString()}`);
}
