import fs from 'node:fs';
import path from 'node:path';
import { createSandbox } from './lua.js';
import { PATHS } from './paths.js';

const COLLECTOR = /* lua */ `
__monsters = {}

Game = {
  createMonsterType = function(name)
    local mType = { __name = name }
    mType.register = function(_, data)
      __monsters[#__monsters + 1] = { name = name, data = data }
      return true
    end
    -- Some files assign callbacks (onThink, onAppear...) or read unknown
    -- members. Absorb both instead of erroring.
    return setmetatable(mType, {
      __index = function() return function() end end,
    })
  end,
}
`;

/** Raw shape as it appears in the Lua files. */
interface RawMonster {
  name: string;
  data: {
    description?: string;
    experience?: number;
    health?: number;
    maxHealth?: number;
    speed?: number;
    corpse?: number;
    race?: string;
    raceId?: number;
    manaCost?: number;
    outfit?: Record<string, number>;
    Bestiary?: {
      class?: string;
      race?: string;
      toKill?: number;
      FirstUnlock?: number;
      SecondUnlock?: number;
      CharmsPoints?: number;
      Stars?: number;
      Occurrence?: number;
      Locations?: string;
    };
    bosstiary?: { bossRaceId?: number; bossRace?: string };
    flags?: Record<string, boolean | number>;
    loot?: Array<{ name?: string; id?: number; chance?: number; maxCount?: number; subType?: number }>;
    attacks?: RawAttack[];
    defenses?: Record<string, unknown> & { defense?: number; armor?: number; mitigation?: number };
    elements?: Array<{ type?: string; percent?: number }>;
    immunities?: Array<{ type?: string; condition?: boolean }>;
    summon?: { maxSummons?: number; summons?: RawSummon[] };
    summons?: RawSummon[];
    changeTarget?: { interval?: number; chance?: number };
    strategiesTarget?: Record<string, number>;
  };
}

interface RawAttack {
  name?: string;
  interval?: number;
  chance?: number;
  minDamage?: number;
  maxDamage?: number;
  type?: string;
  range?: number;
  radius?: number;
  length?: number;
  spread?: number;
  target?: boolean;
  skill?: number;
  attack?: number;
  effect?: string;
  shootEffect?: string;
  duration?: number;
  speedChange?: number;
}

interface RawSummon {
  name?: string;
  chance?: number;
  interval?: number;
  count?: number;
}

export interface MonsterAttack {
  kind: 'melee' | 'combat' | 'other';
  name: string;
  interval: number;
  chance: number;
  minDamage: number;
  maxDamage: number;
  damageType: string;
  range: number | null;
  area: boolean;
  effect: string | null;
  shootEffect: string | null;
}

export interface MonsterHeal {
  interval: number;
  chance: number;
  min: number;
  max: number;
}

export interface Monster {
  id: string;
  name: string;
  description: string | null;
  experience: number;
  health: number;
  speed: number;
  corpse: number | null;
  raceId: number | null;
  bloodType: string | null;
  lookType: number | null;
  lookTypeEx: number | null;
  outfit: Record<string, number> | null;
  category: string;
  isBoss: boolean;
  /** Crystal `bosstiary.bossRace` → bane | archfoe | nemesis. */
  bosstiaryRace: 'bane' | 'archfoe' | 'nemesis' | null;
  bossRaceId: number | null;
  bestiary: {
    class: string;
    race: string;
    toKill: number;
    firstUnlock: number;
    secondUnlock: number;
    charmPoints: number;
    stars: number;
    locations: string | null;
  } | null;
  armor: number;
  defense: number;
  mitigation: number;
  targetDistance: number;
  runOnHealth: number;
  staticAttackChance: number;
  attacks: MonsterAttack[];
  heals: MonsterHeal[];
  /** combat type -> percent. Positive resists, negative is a weakness. */
  elements: Record<string, number>;
  immunities: string[];
  loot: Array<{ itemName: string | null; itemId: number | null; chance: number; maxCount: number }>;
  summons: Array<{ name: string; chance: number; interval: number; count: number }>;
  flags: {
    hostile: boolean;
    attackable: boolean;
    pushable: boolean;
    rewardBoss: boolean;
    healthHidden: boolean;
  };
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseBosstiaryRace(raw: string): Monster['bosstiaryRace'] {
  const s = raw.toUpperCase();
  if (s.includes('BANE')) return 'bane';
  if (s.includes('ARCHFOE')) return 'archfoe';
  if (s.includes('NEMESIS')) return 'nemesis';
  return null;
}

function normalise(raw: RawMonster, category: string): Monster {
  const d = raw.data ?? {};
  const outfit = d.outfit ?? null;
  const attacks: MonsterAttack[] = [];
  const heals: MonsterHeal[] = [];

  for (const a of d.attacks ?? []) {
    const min = Math.abs(num(a.minDamage));
    const max = Math.abs(num(a.maxDamage));
    attacks.push({
      kind: a.name === 'melee' ? 'melee' : a.name === 'combat' ? 'combat' : 'other',
      name: a.name ?? 'unknown',
      interval: num(a.interval, 2000),
      chance: num(a.chance, 100),
      minDamage: Math.min(min, max),
      maxDamage: Math.max(min, max),
      damageType: a.type ?? 'COMBAT_PHYSICALDAMAGE',
      range: typeof a.range === 'number' ? a.range : null,
      area: typeof a.radius === 'number' || typeof a.length === 'number',
      effect: a.effect ?? null,
      shootEffect: a.shootEffect ?? null,
    });
  }

  // `defenses` mixes scalars (defense/armor/mitigation) with an array part of
  // defensive spells. Healing spells are the only part that matters for us.
  const defenses = d.defenses ?? {};
  for (const value of Object.values(defenses)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as RawAttack;
    if (entry.type === 'COMBAT_HEALING') {
      heals.push({
        interval: num(entry.interval, 2000),
        chance: num(entry.chance, 10),
        min: Math.abs(num(entry.minDamage)),
        max: Math.abs(num(entry.maxDamage)),
      });
    }
  }

  const elements: Record<string, number> = {};
  for (const e of d.elements ?? []) {
    if (e.type) elements[e.type] = num(e.percent);
  }

  const summonList = d.summon?.summons ?? d.summons ?? [];
  const flags = d.flags ?? {};

  const bestiary = d.Bestiary
    ? {
        class: d.Bestiary.class ?? 'Unknown',
        race: d.Bestiary.race ?? 'BESTY_RACE_NONE',
        toKill: num(d.Bestiary.toKill, 0),
        firstUnlock: num(d.Bestiary.FirstUnlock, 0),
        secondUnlock: num(d.Bestiary.SecondUnlock, 0),
        charmPoints: num(d.Bestiary.CharmsPoints, 0),
        stars: num(d.Bestiary.Stars, 0),
        locations: d.Bestiary.Locations ?? null,
      }
    : null;

  const health = num(d.health, num(d.maxHealth, 1));
  const raceRaw = d.bosstiary?.bossRace != null ? String(d.bosstiary.bossRace) : '';
  const bosstiaryRace = parseBosstiaryRace(raceRaw);

  return {
    id: raw.name.toLowerCase(),
    name: raw.name,
    description: d.description ?? null,
    experience: num(d.experience),
    health: Math.max(1, health),
    speed: num(d.speed, 100),
    corpse: typeof d.corpse === 'number' ? d.corpse : null,
    raceId: typeof d.raceId === 'number' ? d.raceId : null,
    bloodType: d.race ?? null,
    lookType: outfit && typeof outfit['lookType'] === 'number' ? outfit['lookType'] : null,
    lookTypeEx: outfit && typeof outfit['lookTypeEx'] === 'number' ? outfit['lookTypeEx'] : null,
    outfit,
    category,
    isBoss: Boolean(d.bosstiary) || flags['rewardBoss'] === true,
    bosstiaryRace,
    bossRaceId: typeof d.bosstiary?.bossRaceId === 'number' ? d.bosstiary.bossRaceId : null,
    bestiary,
    armor: num(defenses.armor),
    defense: num(defenses.defense),
    mitigation: num(defenses.mitigation),
    targetDistance: num(flags['targetDistance'], 1),
    runOnHealth: num(flags['runHealth']),
    staticAttackChance: num(flags['staticAttackChance'], 95),
    attacks,
    heals,
    elements,
    immunities: (d.immunities ?? []).filter((i) => i.condition !== false).map((i) => i.type ?? '').filter(Boolean),
    loot: (d.loot ?? []).map((l) => ({
      itemName: l.name ?? null,
      itemId: typeof l.id === 'number' ? l.id : null,
      chance: num(l.chance),
      maxCount: num(l.maxCount, 1),
    })),
    summons: summonList.map((s) => ({
      name: s.name ?? '',
      chance: num(s.chance),
      interval: num(s.interval, 2000),
      count: num(s.count, 1),
    })),
    flags: {
      hostile: flags['hostile'] === true,
      attackable: flags['attackable'] !== false,
      pushable: flags['pushable'] === true,
      rewardBoss: flags['rewardBoss'] === true,
      healthHidden: flags['healthHidden'] === true,
    },
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.lua')) out.push(full);
  }
  return out;
}

export interface MonsterResult {
  monsters: Monster[];
  errors: string[];
  duplicates: string[];
  fileCount: number;
}

export async function parseMonsters(): Promise<MonsterResult> {
  const files = walk(PATHS.monsters).sort();
  const sandbox = await createSandbox(COLLECTOR);
  const errors: string[] = [];
  const byName = new Map<string, Monster>();
  const duplicates: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // Drain the accumulator per file. Reading a growing global would make this
    // quadratic over 1,800 files.
    sandbox.run('__monsters = {}', 'reset');
    const error = sandbox.run(source, path.relative(PATHS.monsters, file));
    if (error) {
      errors.push(error);
      continue;
    }
    const produced = sandbox.read<RawMonster[]>('__monsters');
    const category = path.basename(path.dirname(file));
    for (const raw of produced) {
      const monster = normalise(raw, category);
      if (byName.has(monster.id)) duplicates.push(`${monster.name} (${file})`);
      // Later files win, matching the server's own load order.
      byName.set(monster.id, monster);
    }
  }

  sandbox.close();
  return {
    monsters: [...byName.values()].sort((a, b) => a.id.localeCompare(b.id)),
    errors,
    duplicates,
    fileCount: files.length,
  };
}
