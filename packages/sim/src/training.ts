import { addManaSpent, addSkillTries, dummySkillName } from './character.js';
import {
  availableExerciseHits, consumeExerciseHits, triesPerExerciseCharge,
} from './exercise.js';
import type { CharacterState } from './types.js';

/** Cadence with exercise weapon at a dummy (Crystal ~2s). */
export const ONLINE_EXERCISE_MS = 2_000;
/** Free public dummy cadence (matches offline idle). */
export const ONLINE_FREE_MS = 8_000;
/** Cap per sync request to limit abuse. */
export const MAX_ONLINE_TRAIN_MS = 30_000;

/**
 * Online training while the player is in a training room (not hunting).
 * Burns exercise charges when available (7 tries / charge, 2s each).
 */
export function trainOnline(character: CharacterState, elapsedMs: number): number {
  const ms = Math.min(Math.max(0, elapsedMs), MAX_ONLINE_TRAIN_MS);
  if (ms <= 0) return 0;

  const skill = dummySkillName(character);
  const canExercise = availableExerciseHits(character, skill) > 0;
  const interval = canExercise ? ONLINE_EXERCISE_MS : ONLINE_FREE_MS;
  const hits = Math.floor(ms / interval);
  if (hits <= 0) return 0;

  if (canExercise) {
    const used = consumeExerciseHits(character, skill, hits);
    if (used <= 0) return 0;
    const gained = used * triesPerExerciseCharge(skill);
    if (skill === 'magic') addManaSpent(character, gained, 1);
    else addSkillTries(character, skill, gained, 1);
    character.lastDummyTries = gained;
    return gained;
  }

  if (skill === 'magic') {
    const gained = hits * 20;
    addManaSpent(character, gained, 1);
    character.lastDummyTries = gained;
    return gained;
  }
  addSkillTries(character, skill, hits, 1);
  character.lastDummyTries = hits;
  return hits;
}

export function onlineTrainIntervalMs(character: CharacterState): number {
  const skill = dummySkillName(character);
  return availableExerciseHits(character, skill) > 0 ? ONLINE_EXERCISE_MS : ONLINE_FREE_MS;
}
