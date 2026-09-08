import { describe, expect, it } from 'vitest';
import { advance, createCharacter, deriveStats, startSession } from '../src/index.js';

const DRAGON_HUNT = 'darashia-dragon-lair';

function readyKnight(level = 50): ReturnType<typeof createCharacter> {
  const character = createCharacter('Kina', 4);
  character.level = level;
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = Math.max(character.mana, stats.maxMana);
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  return character;
}

describe('creature flee (runOnHealth absolute HP)', () => {
  it('does not mass-flee dragons on every hit while above 300 HP', () => {
    const session = startSession(readyKnight(50), DRAGON_HUNT, 42n);
    const startUids = session.active.map((monster) => monster.uid);
    expect(startUids.length).toBeGreaterThan(0);
    const events = advance(session, 24, { maxEvents: 800 });
    const flees = events.filter((event) => event.type === 'monster_flee');
    // Old bug treated runOnHealth:300 as 300% → every hit fled and respawned the pack.
    expect(flees).toHaveLength(0);
    expect(session.active.some((monster) => startUids.includes(monster.uid))).toBe(true);
  });

  it('only flees a dragon when creatureFlee is enabled and HP ≤ 300', () => {
    const session = startSession(readyKnight(50), DRAGON_HUNT, 7n);
    const target = session.active[0]!;
    expect(target.maxHealth).toBe(1000);
    target.health = 300;
    const events = advance(session, 8, { maxEvents: 200, creatureFlee: true });
    expect(events.some((event) => event.type === 'monster_flee' && event.uid === target.uid)).toBe(true);
    expect(session.active.some((monster) => monster.uid === target.uid)).toBe(false);
  });
});
