import fs from 'node:fs';
import { createSandbox } from './lua.js';
import { PATHS } from './paths.js';

/** Charms, experience stages and prey bonuses. */

export interface Charm {
  id: number;
  name: string;
  description: string | null;
  category: string;
  type: string;
  /** Damage as a percentage of the target's max HP, for offensive charms. */
  percent: number | null;
  /** Proc chance per tier. */
  chance: [number, number, number];
  /** Charm point cost per tier. */
  points: [number, number, number];
}

export interface Stage {
  minLevel: number;
  maxLevel: number | null;
  multiplier: number;
}

export interface Stages {
  experience: Stage[];
  skills: Stage[];
  magicLevel: Stage[];
}

/**
 * Slice out a balanced `{...}` literal starting at the first brace after `from`.
 *
 * Comments must be skipped, not just strings: an apostrophe in a comment
 * ("-- the creature's hit points") would otherwise open a string that never
 * closes and swallow the rest of the file.
 */
function braceBlock(source: string, from: number): string {
  const start = source.indexOf('{', from);
  if (start < 0) throw new Error('table literal not found');

  let depth = 0;
  let inString: string | null = null;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === inString) inString = null;
      continue;
    }

    if (ch === '-' && source[i + 1] === '-') {
      const long = /^--\[(=*)\[/.exec(source.slice(i));
      if (long) {
        const close = `]${long[1] ?? ''}]`;
        const end = source.indexOf(close, i);
        i = end < 0 ? source.length : end + close.length - 1;
      } else {
        const end = source.indexOf('\n', i);
        i = end < 0 ? source.length : end;
      }
      continue;
    }

    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error('unbalanced table literal');
}

/**
 * bestiary_charms.lua declares `local charms = { [1] = {...}, ... }` and then
 * registers them through engine APIs. We evaluate only the table literal, so
 * the registration calls (which need the real engine) never run.
 */
export async function parseCharms(): Promise<Charm[]> {
  const source = fs.readFileSync(PATHS.charmsLua, 'utf8');
  const literal = braceBlock(source, source.indexOf('local charms'));

  const sandbox = await createSandbox();
  const error = sandbox.run(`__charms = ${literal}`, 'bestiary_charms.lua');
  if (error) {
    sandbox.close();
    throw new Error(error);
  }

  const raw = sandbox.read<Record<string, {
    name?: string;
    description?: string;
    category?: string;
    type?: string;
    percent?: number;
    chance?: number[];
    points?: number[];
  }>>('__charms');
  sandbox.close();

  const triple = (v: number[] | undefined): [number, number, number] => [
    v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0,
  ];

  return Object.entries(raw)
    .map(([id, c]) => ({
      id: Number.parseInt(id, 10),
      name: c.name ?? '',
      // Descriptions use `\z` continuations, which leave runs of whitespace.
      description: c.description?.replace(/\s+/g, ' ').trim() ?? null,
      category: c.category ?? 'UNKNOWN',
      type: c.type ?? 'UNKNOWN',
      percent: typeof c.percent === 'number' ? c.percent : null,
      chance: triple(c.chance),
      points: triple(c.points),
    }))
    .filter((c) => c.name)
    .sort((a, b) => a.id - b.id);
}

export async function parseStages(): Promise<Stages> {
  const sandbox = await createSandbox();
  const error = sandbox.run(fs.readFileSync(PATHS.stagesLua, 'utf8'), 'stages.lua');
  if (error) {
    sandbox.close();
    throw new Error(error);
  }

  const read = (name: string): Stage[] => {
    const raw = sandbox.read<Array<{ minlevel?: number; maxlevel?: number; multiplier?: number }>>(name);
    return raw.map((s) => ({
      minLevel: s.minlevel ?? 1,
      maxLevel: typeof s.maxlevel === 'number' ? s.maxlevel : null,
      multiplier: s.multiplier ?? 1,
    }));
  };

  const stages: Stages = {
    experience: read('experienceStages'),
    skills: read('skillsStages'),
    magicLevel: read('magicLevelStages'),
  };
  sandbox.close();
  return stages;
}

/**
 * Prey bonus percentages, from PreySlot::reloadBonusValue in
 * src/io/ioprey.cpp. Stored as data because the C++ computes them rather than
 * reading a table.
 */
export function preyBonuses(): Record<string, number[]> {
  const stars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return {
    damage: stars.map((s) => 2 * s + 5),
    defense: stars.map((s) => 2 * s + 10),
    experience: stars.map((s) => 3 * s + 10),
    loot: stars.map((s) => 3 * s + 10),
  };
}
