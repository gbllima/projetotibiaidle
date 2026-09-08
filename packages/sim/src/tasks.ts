import { getHunt, monsters, monstersById } from '@tibia-idle/data';
import { addExperience } from './character.js';
import type { CharacterState, HuntingTask } from './types.js';

/** Gold to discard an unfinished task and roll another. */
export const TASK_SKIP_GOLD = 500;

/**
 * A hunting task for the cave's main species.
 *
 * Count scales with level so a level 8 rotworm task is a few dozen kills and a
 * high-level task is a few hundred — the same cadence as CipSoft's old
 * "Killing in the Name of…" tasks, sized for idle sessions.
 */
export function makeHuntTask(character: CharacterState, huntId: string): HuntingTask {
  const hunt = getHunt(huntId);
  const monster = hunt.monsters.map((id) => monstersById.get(id)).find((entry) => entry)
    ?? monsters[0];
  if (!monster) throw new Error('No monster catalog to build a hunting task.');
  const monsterId = monster.id;
  const required = Math.max(20, Math.min(300, Math.round(15 + character.level * 1.2)));
  const gold = required * Math.max(8, Math.floor(monster.experience * 0.35));
  const experience = required * Math.max(1, Math.floor(monster.experience * 0.15));
  return { monsterId, required, progress: 0, gold, experience, claimed: false };
}

/** Credit one kill. Returns true when the task just completed. */
export function creditTaskKill(character: CharacterState, monsterId: string): boolean {
  const task = character.task;
  if (!task || task.claimed || task.monsterId !== monsterId) return false;
  task.progress += 1;
  if (task.progress < task.required) return false;
  task.claimed = true;
  task.progress = task.required;
  character.gold += task.gold;
  addExperience(character, task.experience);
  return true;
}

export function ensureHuntTask(character: CharacterState, huntId: string): HuntingTask {
  if (character.task && !character.task.claimed) return character.task;
  character.task = makeHuntTask(character, huntId);
  character.lastHuntId = huntId;
  return character.task;
}
