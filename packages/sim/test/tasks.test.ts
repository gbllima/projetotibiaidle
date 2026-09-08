import { getMonster, monsters } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import {
  createCharacter, creditTaskKill, huntMultipliers, makeHuntTask, trainOffline,
} from '../src/index.js';

describe('hunting tasks', () => {
  it('pays gold and experience when the kill count is met', () => {
    const character = createCharacter('Kina', 4);
    character.gold = 0;
    const startXp = character.experience;
    character.task = makeHuntTask(character, 'venore-rotworm-cave');
    const monsterId = character.task.monsterId;
    expect(getMonster(monsterId).id).toBe(monsterId);

    let done = false;
    for (let i = 0; i < character.task.required; i += 1) {
      done = creditTaskKill(character, monsterId);
    }
    expect(done).toBe(true);
    expect(character.task.claimed).toBe(true);
    expect(character.gold).toBe(character.task.gold);
    expect(character.experience).toBeGreaterThan(startXp);
  });
});

describe('bestiary knowledge', () => {
  it('boosts damage after the first unlock', () => {
    const beast = monsters.find((monster) => (monster.bestiary?.firstUnlock ?? 0) > 0);
    expect(beast).toBeDefined();
    const character = createCharacter('Kina', 4);
    const base = huntMultipliers(character, beast!.id);
    character.bestiary[beast!.id] = beast!.bestiary!.firstUnlock;
    const known = huntMultipliers(character, beast!.id);
    expect(known.damage).toBeGreaterThan(base.damage);
  });
});

describe('offline training', () => {
  it('trains the vocation weapon while the character is away', () => {
    const knight = createCharacter('Bowen', 4);
    knight.startWeapon = 'sword';
    const before = knight.skills.sword.tries;
    const tries = trainOffline(knight, 80_000);
    expect(tries).toBeGreaterThan(0);
    expect(knight.skills.sword.tries).toBeGreaterThan(before);
  });
});
