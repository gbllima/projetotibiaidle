import { hunts, itemsById, recommendedLevelFor } from '@tibia-idle/data';
import { advance } from '../src/combat.js';
import { referenceCharacter } from '../src/reference.js';
import { startSession } from '../src/combat.js';
import { TICKS_PER_HOUR } from '../src/types.js';
import { bestTier, HEALTH_POTION_TIERS, MANA_POTION_TIERS } from '../src/supplies.js';

/**
 * Measures potions burned per hour, per vocation and level band.
 *
 * Supply packs are sized from these numbers rather than a flat guess: pack too
 * small and every hunt ends early, pack too large and a new character cannot
 * afford to leave town.
 */

const VOCATIONS = [
  { id: 4, name: 'knight' },
  { id: 3, name: 'paladin' },
  { id: 1, name: 'sorcerer' },
  { id: 2, name: 'druid' },
  { id: 9, name: 'monk' },
];

const LEVELS = [8, 20, 50, 100, 200, 400, 700];

interface Sample {
  level: number;
  vocation: string;
  health: number;
  mana: number;
}

const samples: Sample[] = [];

for (const level of LEVELS) {
  for (const vocation of VOCATIONS) {
    // Hunt the hardest zone this level is cleared for: that is where supply
    // burn peaks, and packing for the easy case would strand players there.
    const candidates = hunts
      .map((hunt) => ({ hunt, required: recommendedLevelFor(hunt.id, vocation.id) }))
      .filter((entry): entry is { hunt: (typeof hunts)[number]; required: number } =>
        entry.required !== null && entry.required <= level)
      .sort((a, b) => b.required - a.required);

    const target = candidates[0];
    if (!target) {
      samples.push({ level, vocation: vocation.name, health: -1, mana: -1 });
      continue;
    }

    const character = referenceCharacter(vocation.id, level);
    const health = bestTier(HEALTH_POTION_TIERS, level);
    const mana = bestTier(MANA_POTION_TIERS, level);
    // Deliberately oversupplied so the run never ends early and we measure the
    // rate rather than the size of the bag.
    character.supplies = [
      { itemId: health.itemId, count: 1_000_000 },
      { itemId: mana.itemId, count: 1_000_000 },
    ];
    const manaId = mana.itemId;
    const before = new Map(character.supplies.map((stack) => [stack.itemId, stack.count]));

    const session = startSession(character, target.hunt.id, 1234n);
    advance(session, TICKS_PER_HOUR, { maxEvents: 0 });

    let healthUsed = 0;
    let manaUsed = 0;
    for (const stack of character.supplies) {
      const used = (before.get(stack.itemId) ?? 0) - stack.count;
      if (stack.itemId === manaId) manaUsed += used;
      else healthUsed += used;
    }
    samples.push({ level, vocation: vocation.name, health: healthUsed, mana: manaUsed });
  }
}

console.log('level  vocation   health/h  mana/h');
for (const sample of samples) {
  console.log(
    `${String(sample.level).padStart(5)}  ${sample.vocation.padEnd(9)} ${String(sample.health).padStart(8)}  ${String(sample.mana).padStart(6)}`,
  );
}

const peak = samples.reduce((max, s) => Math.max(max, s.health, s.mana), 0);
console.log(`\npeak per hour: ${peak}   (-1 means no hunt is open to that level)`);
for (const tier of [...HEALTH_POTION_TIERS, ...MANA_POTION_TIERS]) {
  console.log(`  ${tier.name.padEnd(24)} lvl ${String(tier.level).padStart(3)}  ${itemsById.get(tier.itemId)?.buyPrice ?? '?'} gp`);
}
