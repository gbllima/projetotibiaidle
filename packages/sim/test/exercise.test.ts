import { describe, expect, it } from 'vitest';
import { createCharacter, trainOffline } from '../src/index.js';

describe('exercise weapons', () => {
  it('continues free training after the last charge during the same absence', () => {
    const character = createCharacter('Kina', 4);
    character.supplies = [{ itemId: 28552, count: 1 }];
    expect(trainOffline(character, 24_000)).toBe(9);
    expect(character.supplies[0]?.count).toBe(0);
  });

  it('caps offline training at eight hours and reports actual magic mana gained', () => {
    const character = createCharacter('Mage', 1);
    expect(trainOffline(character, 24 * 3_600_000)).toBe(3600 * 20);
    expect(character.lastDummyTries).toBe(3600 * 20);
  });
  it('burns exercise sword charges offline instead of the free dummy rate', () => {
    const character = createCharacter('Kina', 4);
    character.supplies = [{ itemId: 28552, count: 3 }];
    const gained = trainOffline(character, 24_000);
    expect(gained).toBe(21);
    expect(character.supplies[0]?.count).toBe(0);
    expect(character.lastDummyTries).toBe(21);
  });

  it('falls back to the free dummy when no exercise weapon is available', () => {
    const character = createCharacter('Kina', 4);
    const gained = trainOffline(character, 16_000);
    expect(gained).toBe(2);
    expect(character.lastDummyTries).toBe(2);
  });
});
