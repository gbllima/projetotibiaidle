import fs from 'node:fs';
import { PATHS } from './paths.js';

/**
 * Hunting places are the backbone of the idle loop: each one becomes a zone,
 * and its official `Xp/Hour` is the target our combat simulation is calibrated
 * against. See docs/00-ANALISE-TECNICA.md section 4.3.
 */

interface RawHunt {
  Name: string;
  Level: string;
  Type: string[];
  'Xp/Hour': string;
  'Loot/Hour'?: string;
  Location?: string;
  Vocation?: string[];
  PremiumRequired?: boolean;
  RecommendedSupplies?: Record<string, string[]>;
  RecommendedImbues?: Record<string, string[]>;
  ValuableDrops?: string[];
  Monsters?: Array<{ Name: string; Resistances?: string }>;
}

export type HuntPartySize = 'solo' | 'duo' | 'party4';

export interface Hunt {
  id: string;
  name: string;
  level: number;
  location: string | null;
  partySizes: HuntPartySize[];
  /** Official reference rates, already expanded from "80K" / "6KK" notation. */
  expectedXpPerHour: number;
  expectedLootPerHour: number;
  vocations: string[];
  premium: boolean;
  monsters: string[];
  valuableDrops: string[];
  recommendedSupplies: Record<string, string[]>;
}

/** Tibia shorthand: 80K = 80,000; 6KK = 6,000,000; 12.5KK = 12,500,000. */
export function parseTibiaNumber(input: string | undefined): number {
  if (!input) return 0;
  const match = /^([\d.,]+)\s*(k*)$/i.exec(input.trim());
  if (!match) return 0;
  const value = Number.parseFloat((match[1] ?? '0').replace(/,/g, ''));
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000 ** (match[2] ?? '').length);
}

const PARTY_MAP: Record<string, HuntPartySize> = {
  solo: 'solo',
  duo: 'duo',
  'party x4': 'party4',
};

const slug = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function parseHunts(): Hunt[] {
  const raw = JSON.parse(fs.readFileSync(PATHS.huntingPlaces, 'utf8')) as RawHunt[];
  const seen = new Set<string>();

  return raw.map((entry) => {
    let id = slug(entry.Name);
    let suffix = 2;
    while (seen.has(id)) id = `${slug(entry.Name)}-${suffix++}`;
    seen.add(id);

    return {
      id,
      name: entry.Name,
      level: Number.parseInt(entry.Level, 10) || 1,
      location: entry.Location ?? null,
      partySizes: (entry.Type ?? [])
        .map((t) => PARTY_MAP[t.toLowerCase()])
        .filter((t): t is HuntPartySize => Boolean(t)),
      expectedXpPerHour: parseTibiaNumber(entry['Xp/Hour']),
      expectedLootPerHour: parseTibiaNumber(entry['Loot/Hour']),
      vocations: (entry.Vocation ?? []).map((v) => v.toLowerCase()),
      premium: entry.PremiumRequired === true,
      monsters: (entry.Monsters ?? []).map((m) => m.Name.toLowerCase()),
      valuableDrops: (entry.ValuableDrops ?? []).map((d) => d.toLowerCase()),
      recommendedSupplies: Object.fromEntries(
        Object.entries(entry.RecommendedSupplies ?? {}).map(([voc, list]) => [
          voc.toLowerCase(),
          list.map((s) => s.toLowerCase()),
        ]),
      ),
    };
  });
}
