import { describe, expect, it } from 'vitest';
import { getMonster } from '@tibia-idle/data';
import {
  bestLoadout,
  createCharacter,
  deriveStats,
  startSession,
} from '../src/index.js';

const HUNT = 'venore-rotworm-cave';

function starterKnight() {
  const character = createCharacter('Starter', 4);
  character.level = 8;
  character.startWeapon = 'sword';
  character.skills.sword.level = 12;
  character.equipment = bestLoadout(character, 3_000);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  return character;
}

describe('starter Venore combat pacing', () => {
  it('reduces only the remaining first three lifetime Rotworms', () => {
    const regularHealth = getMonster('rotworm').health;

    const fresh = starterKnight();
    const firstSession = startSession(fresh, HUNT, 101n);
    expect(firstSession.active.filter((monster) => monster.maxHealth < regularHealth)).toHaveLength(3);

    const almostDone = starterKnight();
    almostDone.bestiary.rotworm = 2;
    const remainingSession = startSession(almostDone, HUNT, 102n);
    expect(remainingSession.active.filter((monster) => monster.maxHealth < regularHealth)).toHaveLength(1);

    const completed = starterKnight();
    completed.bestiary.rotworm = 3;
    const normalSession = startSession(completed, HUNT, 103n);
    expect(normalSession.active.every((monster) => monster.maxHealth === regularHealth)).toBe(true);
  });

  it('does not apply starter pacing after level 10', () => {
    const character = starterKnight();
    character.level = 11;
    const stats = deriveStats(character);
    character.health = stats.maxHealth;
    character.mana = stats.maxMana;
    const regularHealth = getMonster('rotworm').health;
    const session = startSession(character, HUNT, 104n);
    expect(session.active.every((monster) => monster.maxHealth === regularHealth)).toBe(true);
  });
});
