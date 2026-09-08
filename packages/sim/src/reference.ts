import type { SkillName } from '@tibia-idle/data';
import { createCharacter, deriveStats, isDistanceVocation, isMagicVocation } from './character.js';
import { bestLoadout, gearBudget } from './gear.js';
import type { CharacterState } from './types.js';

/**
 * Reference characters.
 *
 * Calibration needs to know what a *typical* player of a given level looks
 * like, because the official Xp/Hour figures in hunting_places.json assume a
 * competent character rather than a naked one. These curves come from the
 * observed skill of real players at each level bracket; they are anchors for
 * interpolation, not a formula from the server.
 */

interface SkillAnchor {
  level: number;
  melee: number;
  distance: number;
  magic: number;
  shield: number;
}

const ANCHORS: SkillAnchor[] = [
  { level: 8, melee: 12, distance: 12, magic: 1, shield: 11 },
  { level: 20, melee: 35, distance: 40, magic: 10, shield: 25 },
  { level: 50, melee: 65, distance: 72, magic: 30, shield: 45 },
  { level: 100, melee: 85, distance: 92, magic: 55, shield: 62 },
  { level: 200, melee: 105, distance: 112, magic: 80, shield: 80 },
  { level: 400, melee: 125, distance: 132, magic: 100, shield: 95 },
  { level: 800, melee: 140, distance: 148, magic: 118, shield: 108 },
];

function interpolate(level: number, key: keyof Omit<SkillAnchor, 'level'>): number {
  const first = ANCHORS[0]!;
  const last = ANCHORS[ANCHORS.length - 1]!;
  if (level <= first.level) return first[key];
  if (level >= last.level) return last[key];

  for (let i = 1; i < ANCHORS.length; i += 1) {
    const hi = ANCHORS[i]!;
    if (level > hi.level) continue;
    const lo = ANCHORS[i - 1]!;
    const t = (level - lo.level) / (hi.level - lo.level);
    return Math.round(lo[key] + (hi[key] - lo[key]) * t);
  }
  return last[key];
}

/** Typical skills for a character of this level and vocation. */
export function referenceSkills(vocationId: number, level: number): {
  weapon: number;
  shield: number;
  magic: number;
} {
  const magic = isMagicVocation(vocationId);
  const distance = isDistanceVocation(vocationId);
  return {
    weapon: interpolate(level, distance ? 'distance' : 'melee'),
    shield: interpolate(level, 'shield'),
    // Casters live off magic level; everyone else picks up a little.
    magic: magic ? interpolate(level, 'magic') : Math.round(interpolate(level, 'magic') * 0.25),
  };
}

/**
 * A fully kitted character at a given level, for calibration and for previewing
 * a hunt before the player commits to it.
 */
export function referenceCharacter(vocationId: number, level: number, budget?: number): CharacterState {
  const character = createCharacter(`Reference ${level}`, vocationId);
  character.level = Math.max(8, level);

  const skills = referenceSkills(vocationId, character.level);
  const weaponSkills: SkillName[] = ['sword', 'axe', 'club', 'distance', 'fist'];
  for (const skill of weaponSkills) character.skills[skill].level = skills.weapon;
  character.skills.shield.level = skills.shield;
  character.magicLevel = skills.magic;

  character.equipment = bestLoadout(character, budget ?? gearBudget(character.level));

  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  return character;
}
