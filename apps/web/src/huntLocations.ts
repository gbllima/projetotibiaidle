import type { HuntView } from './api/types.js';

export const HUNT_REGIONS: ReadonlyArray<{ name: string; locations: readonly string[] }> = [
  {
    name: 'Mainland',
    locations: [
      'Carlin', 'Edron', 'Venore', 'Kazordoon', 'Svargrond', 'Yalahar', 'Oramond',
      'Farmine', 'Krailos', 'Ingol', 'Mistrock', 'Northport', 'Liberty Bay', 'Gray Island',
    ],
  },
  {
    name: 'Darama',
    locations: ['Darashia', 'Ankrahmun', 'Darama', "Kha'labal", "Kha'zeel", 'Issavi', 'Fenrock', 'Drefia'],
  },
  {
    name: 'Tiquanda',
    locations: ['Port Hope', 'Tiquanda', 'Banuta', 'Amazon', "Ab'Dendriel", 'Elves', 'Iksupan', 'Ramoa', 'Stampor', 'Summer'],
  },
  {
    name: 'Ilhas',
    locations: ['Marapur', 'Rascacoon', 'Meriana', 'Candia', 'Podzilla'],
  },
  {
    name: 'Endgame',
    locations: ['Roshamuul', 'Warzone', 'Netherworld', 'Nightmare', 'Fire', 'Lower', 'Asura', 'Catacombs', 'Spike'],
  },
];

export type LocationBucket = {
  location: string;
  count: number;
  minLevel: number;
};

export type RegionBucket = {
  name: string;
  locations: LocationBucket[];
  count: number;
};

export function buildHuntRegions(hunts: HuntView[]): RegionBucket[] {
  const byLocation = new Map<string, HuntView[]>();
  for (const hunt of hunts) {
    const location = hunt.location?.trim() || 'Outros';
    const list = byLocation.get(location) ?? [];
    list.push(hunt);
    byLocation.set(location, list);
  }

  const used = new Set<string>();
  const regions: RegionBucket[] = [];

  for (const region of HUNT_REGIONS) {
    const locations: LocationBucket[] = [];
    for (const location of region.locations) {
      const list = byLocation.get(location);
      if (!list?.length) continue;
      used.add(location);
      locations.push({
        location,
        count: list.length,
        minLevel: Math.min(...list.map((h) => h.recommendedLevel ?? h.statedLevel)),
      });
    }
    if (locations.length > 0) {
      regions.push({
        name: region.name,
        locations,
        count: locations.reduce((sum, entry) => sum + entry.count, 0),
      });
    }
  }

  const leftovers = [...byLocation.entries()]
    .filter(([location]) => !used.has(location))
    .map(([location, list]) => ({
      location,
      count: list.length,
      minLevel: Math.min(...list.map((h) => h.recommendedLevel ?? h.statedLevel)),
    }))
    .sort((a, b) => a.location.localeCompare(b.location));

  if (leftovers.length > 0) {
    regions.push({
      name: 'Outros',
      locations: leftovers,
      count: leftovers.reduce((sum, entry) => sum + entry.count, 0),
    });
  }

  return regions;
}

export function sortHunts(a: HuntView, b: HuntView): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
  return (a.recommendedLevel ?? a.statedLevel) - (b.recommendedLevel ?? b.statedLevel);
}
