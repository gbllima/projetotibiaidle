import { describe, expect, it } from 'vitest';
import { createCharacter, trainOffline } from '../src/index.js';

describe('exercise weapons', () => {
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
