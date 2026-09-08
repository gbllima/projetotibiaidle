import { hunts } from '@tibia-idle/data';
import {
  estimateDamagePerSecond, recommendedLevel, referenceCharacter,
  requiredDamagePerSecond, vocationIdsFor,
} from '../src/index.js';

/**
 * Validates the damage model by deriving each zone's recommended level and
 * checking it against what a Tibia player would expect.
 *
 * If levels come out wildly low the damage model is too generous; wildly high
 * and it is too weak. This is the check that keeps the whole economy honest.
 */

console.log('reference damage per second by level\n');
console.log('  level     knight    paladin   sorcerer');
for (const level of [8, 20, 50, 100, 200, 400, 700, 1000]) {
  const row = [4, 3, 1]
    .map((voc) => Math.round(estimateDamagePerSecond(referenceCharacter(voc, level), 3)))
    .map((n) => n.toLocaleString().padStart(10))
    .join(' ');
  console.log(`  ${String(level).padStart(5)}  ${row}`);
}

const rows = hunts
  .filter((h) => h.expectedXpPerHour > 0)
  .map((hunt) => {
    const vocationIds = vocationIdsFor(hunt.vocations);
    const levels = vocationIds.map((id) => ({ id, level: recommendedLevel(hunt.id, id) }));
    const best = levels.reduce((a, b) => (b.level < a.level ? b : a));
    return {
      hunt,
      required: requiredDamagePerSecond(hunt.id),
      recommended: best.level,
      vocationId: best.id,
    };
  })
  .sort((a, b) => a.recommended - b.recommended);

console.log('\n\nrecommended level per zone (stated level in brackets)\n');
for (const row of rows) {
  console.log(
    `  ${String(row.recommended).padStart(5)} [${String(row.hunt.level).padStart(4)}]  ` +
    `voc${row.vocationId}  ${Math.round(row.required).toLocaleString().padStart(7)} dps  ` +
    `${row.hunt.expectedXpPerHour.toLocaleString().padStart(11)} xp/h  ${row.hunt.name}`,
  );
}

const capped = rows.filter((r) => r.recommended >= 1500).length;
console.log(`\n  ${capped} zones exceed the level 1500 search ceiling`);
