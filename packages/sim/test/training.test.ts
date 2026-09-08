import { describe, expect, it } from 'vitest';
import {
  createCharacter,
  exerciseShootEffect,
  exerciseShootForTraining,
  onlineTrainIntervalMs,
  ONLINE_EXERCISE_MS,
  ONLINE_FREE_MS,
  trainOnline,
} from '../src/index.js';

describe('online training', () => {
  it('burns exercise charges every 2s with +7 tries per hit', () => {
    const character = createCharacter('Kina', 4);
    character.supplies = [{ itemId: 28552, count: 2 }];
    expect(onlineTrainIntervalMs(character)).toBe(ONLINE_EXERCISE_MS);

    const gained = trainOnline(character, 4_000);
    expect(gained).toBe(14);
    expect(character.supplies[0]?.count).toBe(0);
    expect(character.lastDummyTries).toBe(14);
  });

  it('falls back to free dummy at 8s cadence without exercise weapon', () => {
    const character = createCharacter('Kina', 4);
    expect(onlineTrainIntervalMs(character)).toBe(ONLINE_FREE_MS);

    const gained = trainOnline(character, 16_000);
    expect(gained).toBe(2);
    expect(character.lastDummyTries).toBe(2);
  });
});

describe('exercise shoot effects', () => {
  it('maps skills to Tibia training missiles', () => {
    expect(exerciseShootEffect('sword')).toBe('CONST_ANI_WHIRLWINDSWORD');
    expect(exerciseShootEffect('magic')).toBe('CONST_ANI_ENERGY');
    expect(exerciseShootEffect('distance')).toBe('CONST_ANI_ARROW');
    expect(exerciseShootEffect('shield')).toBeNull();
  });

  it('uses rod and wand missiles from supplies', () => {
    expect(exerciseShootForTraining('magic', [{ itemId: 28556, count: 10 }])).toBe('CONST_ANI_SMALLICE');
    expect(exerciseShootForTraining('magic', [{ itemId: 28557, count: 10 }])).toBe('CONST_ANI_FIRE');
  });
});
