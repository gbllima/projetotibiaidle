import fs from 'node:fs';
import sax from 'sax';
import { PATHS } from './paths.js';

/** Skill indices used by the engine, matching Vocation::skillBase order. */
export const SKILL_NAMES = ['fist', 'club', 'sword', 'axe', 'distance', 'shield', 'fishing'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface Vocation {
  id: number;
  clientId: number;
  baseId: number;
  name: string;
  description: string;
  gainHp: number;
  gainMana: number;
  /** Capacity gain per level in oz (the XML value is multiplied by 100 by the engine). */
  gainCap: number;
  gainHpTicks: number;
  gainHpAmount: number;
  gainManaTicks: number;
  gainManaAmount: number;
  manaMultiplier: number;
  attackSpeed: number;
  baseSpeed: number;
  soulMax: number;
  gainSoulTicks: number;
  /** Damage/defense multipliers from the <formula> element. */
  meleeDamage: number;
  distDamage: number;
  wandRodDamage: number;
  defense: number;
  armor: number;
  mitigationMultiplier: number;
  mitigationPrimaryShield: number;
  mitigationSecondaryShield: number;
  /** Exponential base for skill advancement, per skill index. */
  skillMultipliers: Record<SkillName, number>;
}

const toNum = (v: string | undefined, fallback = 0): number => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

export async function parseVocations(): Promise<Vocation[]> {
  const parser = sax.createStream(false, { lowercase: true, trim: true });
  const vocations: Vocation[] = [];
  let current: Vocation | null = null;

  parser.on('opentag', (node) => {
    const a = node.attributes as Record<string, string>;
    if (node.name === 'vocation') {
      current = {
        id: toNum(a['id']),
        clientId: toNum(a['clientid']),
        baseId: toNum(a['baseid']),
        name: a['name'] ?? '',
        description: a['description'] ?? '',
        gainHp: toNum(a['gainhp'], 5),
        gainMana: toNum(a['gainmana'], 5),
        gainCap: toNum(a['gaincap'], 10),
        gainHpTicks: toNum(a['gainhpticks'], 12000),
        gainHpAmount: toNum(a['gainhpamount'], 1),
        gainManaTicks: toNum(a['gainmanaticks'], 6000),
        gainManaAmount: toNum(a['gainmanaamount'], 2),
        manaMultiplier: toNum(a['manamultiplier'], 4),
        attackSpeed: toNum(a['attackspeed'], 2000),
        baseSpeed: toNum(a['basespeed'], 110),
        soulMax: toNum(a['soulmax'], 100),
        gainSoulTicks: toNum(a['gainsoulticks'], 120000),
        meleeDamage: 1,
        distDamage: 1,
        wandRodDamage: 1,
        defense: 1,
        armor: 1,
        mitigationMultiplier: 1,
        mitigationPrimaryShield: 1,
        mitigationSecondaryShield: 1,
        skillMultipliers: {
          fist: 1.5, club: 2, sword: 2, axe: 2, distance: 2, shield: 1.5, fishing: 1.1,
        },
      };
      return;
    }
    if (!current) return;

    if (node.name === 'formula') {
      current.meleeDamage = toNum(a['meleedamage'], 1);
      current.distDamage = toNum(a['distdamage'], 1);
      current.wandRodDamage = toNum(a['wandroddamage'], 1);
      current.defense = toNum(a['defense'], 1);
      current.armor = toNum(a['armor'], 1);
    } else if (node.name === 'mitigation') {
      current.mitigationMultiplier = toNum(a['multiplier'], 1);
      current.mitigationPrimaryShield = toNum(a['primaryshield'], 1);
      current.mitigationSecondaryShield = toNum(a['secondaryshield'], 1);
    } else if (node.name === 'skill') {
      const index = toNum(a['id'], -1);
      const name = SKILL_NAMES[index];
      if (name) current.skillMultipliers[name] = toNum(a['multiplier'], 1.5);
    }
  });

  parser.on('closetag', (name) => {
    if (name === 'vocation' && current) {
      vocations.push(current);
      current = null;
    }
  });

  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(PATHS.vocationsXml, 'utf8').pipe(parser);
  });

  return vocations.sort((a, b) => a.id - b.id);
}
