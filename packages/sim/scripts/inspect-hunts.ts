import { getMonster, hunts } from '@tibia-idle/data';
import { huntThroughput } from '../src/index.js';

/** Sanity check on the hunt metadata that calibration depends on. */

const zeroXp = hunts.filter((h) => h.expectedXpPerHour <= 0);
console.log(`hunts with no official xp/h: ${zeroXp.length}`);
for (const hunt of zeroXp) {
  console.log(`  ${hunt.name} (stated level ${hunt.level}, monsters ${hunt.monsters.length})`);
}

const suspicious = ['Ice Library', 'Marapur Turtles', 'West Roshamuul', 'Buried Cathedral'];
for (const name of suspicious) {
  const hunt = hunts.find((h) => h.name === name);
  if (!hunt) { console.log(`\n${name}: missing`); continue; }
  const t = huntThroughput(hunt.id);
  console.log(`\n${hunt.name}`);
  console.log(`  stated level ${hunt.level}, official ${hunt.expectedXpPerHour.toLocaleString()} xp/h`);
  console.log(`  pack ${t.packSize}, ${Math.round(t.killsPerHour)} kills/h, avg hp ${Math.round(t.averageHealth)}`);
  console.log(`  monsters: ${hunt.monsters.map((id) => {
    const m = getMonster(id);
    return `${m.name}(hp ${m.health}, xp ${m.experience})`;
  }).join(', ')}`);
}
