import { itemsById, type CombatType, type SkillName } from '@tibia-idle/data';
import type { CharacterState, EquipSlot, ImbueSlot } from './types.js';

/**
 * Crystal `data/XML/imbuements.xml` — full Basic / Intricate / Powerful catalog.
 * Base shrine prices: 7.500 / 60.000 / 250.000. Duration 20h.
 *
 * Idle maps Crystal item-slot rules onto EquipSlot families (weapon / head /
 * armor / feet / backpack). An equipped piece may hold up to its
 * `imbuementSlots` concurrent imbues (see `ImbueSlot.index`).
 */

export const IMBUEMENT_DURATION_MS = 20 * 60 * 60 * 1000;
export const IMBUEMENT_BASE_COST = [7_500, 60_000, 250_000] as const;
export const IMBUEMENT_CLEAR_COST = 15_000;

export type ImbueCategory =
  | 'elemental'
  | 'lifeLeech'
  | 'manaLeech'
  | 'critical'
  | 'protectDeath'
  | 'protectEarth'
  | 'protectFire'
  | 'protectIce'
  | 'protectEnergy'
  | 'protectHoly'
  | 'speed'
  | 'skillAxe'
  | 'skillSword'
  | 'skillClub'
  | 'skillShield'
  | 'skillDistance'
  | 'skillMagic'
  | 'capacity'
  | 'skillFist'
  | 'vibrancy';

export type ImbuementSpec = {
  id: string;
  name: string;
  category: ImbueCategory;
  slots: EquipSlot[];
  cost: readonly [number, number, number];
  reagents: Array<{ name: string; counts: readonly [number, number, number] }>;
  description: [string, string, string];
} & (
  | { kind: 'critical'; critChance: number; critExtra: readonly [number, number, number] }
  | { kind: 'lifeLeech'; leech: readonly [number, number, number] }
  | { kind: 'manaLeech'; manaLeech: readonly [number, number, number] }
  | { kind: 'convert'; combat: CombatType; percent: readonly [number, number, number] }
  | { kind: 'reduction'; combat: CombatType; percent: readonly [number, number, number] }
  | { kind: 'skill'; skill: SkillName; bonus: readonly [number, number, number] }
  | { kind: 'magic'; magic: readonly [number, number, number] }
  | { kind: 'speed'; speed: readonly [number, number, number] }
  | { kind: 'capacity'; capacity: readonly [number, number, number] }
  | { kind: 'vibrancy'; chance: readonly [number, number, number] }
);

const COST = IMBUEMENT_BASE_COST;
const WEAPON: EquipSlot[] = ['left', 'right'];
const HEAD: EquipSlot[] = ['head'];
const PROTECT: EquipSlot[] = ['armor', 'head', 'legs', 'feet', 'right'];
const BOOTS: EquipSlot[] = ['feet'];
const PACK: EquipSlot[] = ['backpack'];

function reagents(
  entries: Array<[string, number, number, number]>,
): Array<{ name: string; counts: readonly [number, number, number] }> {
  return entries.map(([name, a, b, c]) => ({ name, counts: [a, b, c] as const }));
}

export const IMBUEMENTS: readonly ImbuementSpec[] = [
  {
    id: 'strike', name: 'Strike', category: 'critical', slots: WEAPON, cost: COST,
    kind: 'critical', critChance: 500, critExtra: [500, 1500, 4000],
    description: [
      'Raises crit hit damage by 5% and crit hit chance by 5%.',
      'Raises crit hit damage by 15% and crit hit chance by 5%.',
      'Raises crit hit damage by 40% and crit hit chance by 5%.',
    ],
    reagents: reagents([['protective charm', 20, 20, 20], ['sabretooth', 0, 25, 25], ['vexclaw talon', 0, 0, 5]]),
  },
  {
    id: 'reap', name: 'Reap', category: 'elemental', slots: WEAPON, cost: COST,
    kind: 'convert', combat: 'COMBAT_DEATHDAMAGE', percent: [10, 25, 50],
    description: [
      'Converts 10% of the physical damage to death damage.',
      'Converts 25% of the physical damage to death damage.',
      'Converts 50% of the physical damage to death damage.',
    ],
    reagents: reagents([['pile of grave earth', 25, 25, 25], ['demonic skeletal hand', 0, 20, 20], ['petrified scream', 0, 0, 5]]),
  },
  {
    id: 'venom', name: 'Venom', category: 'elemental', slots: WEAPON, cost: COST,
    kind: 'convert', combat: 'COMBAT_EARTHDAMAGE', percent: [10, 25, 50],
    description: [
      'Converts 10% of the physical damage to earth damage.',
      'Converts 25% of the physical damage to earth damage.',
      'Converts 50% of the physical damage to earth damage.',
    ],
    reagents: reagents([['swamp grass', 25, 25, 25], ['poisonous slime', 0, 20, 20], ['slime heart', 0, 0, 2]]),
  },
  {
    id: 'electrify', name: 'Electrify', category: 'elemental', slots: WEAPON, cost: COST,
    kind: 'convert', combat: 'COMBAT_ENERGYDAMAGE', percent: [10, 25, 50],
    description: [
      'Converts 10% of the physical damage to energy damage.',
      'Converts 25% of the physical damage to energy damage.',
      'Converts 50% of the physical damage to energy damage.',
    ],
    reagents: reagents([['rorc feather', 25, 25, 25], ['peacock feather fan', 0, 5, 5], ['energy vein', 0, 0, 1]]),
  },
  {
    id: 'scorch', name: 'Scorch', category: 'elemental', slots: WEAPON, cost: COST,
    kind: 'convert', combat: 'COMBAT_FIREDAMAGE', percent: [10, 25, 50],
    description: [
      'Converts 10% of the physical damage to fire damage.',
      'Converts 25% of the physical damage to fire damage.',
      'Converts 50% of the physical damage to fire damage.',
    ],
    reagents: reagents([['fiery heart', 25, 25, 25], ['green dragon scale', 0, 5, 5], ['demon horn', 0, 0, 5]]),
  },
  {
    id: 'frost', name: 'Frost', category: 'elemental', slots: WEAPON, cost: COST,
    kind: 'convert', combat: 'COMBAT_ICEDAMAGE', percent: [10, 25, 50],
    description: [
      'Converts 10% of the physical damage to ice damage.',
      'Converts 25% of the physical damage to ice damage.',
      'Converts 50% of the physical damage to ice damage.',
    ],
    reagents: reagents([['frosty heart', 25, 25, 25], ['seacrest hair', 0, 10, 10], ['polar bear paw', 0, 0, 5]]),
  },
  {
    id: 'lich_shroud', name: 'Lich Shroud', category: 'protectDeath', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_DEATHDAMAGE', percent: [2, 5, 10],
    description: ['Reduces death damage by 2%.', 'Reduces death damage by 5%.', 'Reduces death damage by 10%.'],
    reagents: reagents([['flask of embalming fluid', 25, 25, 25], ['gloom wolf fur', 0, 20, 20], ['mystical hourglass', 0, 0, 5]]),
  },
  {
    id: 'snake_skin', name: 'Snake Skin', category: 'protectEarth', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_EARTHDAMAGE', percent: [3, 8, 15],
    description: ['Reduces earth damage by 3%.', 'Reduces earth damage by 8%.', 'Reduces earth damage by 15%.'],
    reagents: reagents([['piece of swampling wood', 25, 25, 25], ['snake skin', 0, 20, 20], ['brimstone fangs', 0, 0, 10]]),
  },
  {
    id: 'cloud_fabric', name: 'Cloud Fabric', category: 'protectEnergy', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_ENERGYDAMAGE', percent: [3, 8, 15],
    description: ['Reduces energy damage by 3%.', 'Reduces energy damage by 8%.', 'Reduces energy damage by 15%.'],
    reagents: reagents([['wyvern talisman', 20, 20, 20], ['crawler head plating', 0, 15, 15], ['wyrm scale', 0, 0, 10]]),
  },
  {
    id: 'dragon_hide', name: 'Dragon Hide', category: 'protectFire', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_FIREDAMAGE', percent: [3, 8, 15],
    description: ['Reduces fire damage by 3%.', 'Reduces fire damage by 8%.', 'Reduces fire damage by 15%.'],
    reagents: reagents([['green dragon leather', 20, 20, 20], ['blazing bone', 0, 10, 10], ['draken sulphur', 0, 0, 5]]),
  },
  {
    id: 'demon_presence', name: 'Demon Presence', category: 'protectHoly', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_HOLYDAMAGE', percent: [3, 8, 15],
    description: ['Reduces holy damage by 3%.', 'Reduces holy damage by 8%.', 'Reduces holy damage by 15%.'],
    reagents: reagents([['cultish robe', 25, 25, 25], ['cultish mask', 0, 25, 25], ['hellspawn tail', 0, 0, 20]]),
  },
  {
    id: 'quara_scale', name: 'Quara Scale', category: 'protectIce', slots: PROTECT, cost: COST,
    kind: 'reduction', combat: 'COMBAT_ICEDAMAGE', percent: [3, 8, 15],
    description: ['Reduces ice damage by 3%.', 'Reduces ice damage by 8%.', 'Reduces ice damage by 15%.'],
    reagents: reagents([['winter wolf fur', 25, 25, 25], ['thick fur', 0, 15, 15], ['deepling warts', 0, 0, 10]]),
  },
  {
    id: 'vampirism', name: 'Vampirism', category: 'lifeLeech', slots: WEAPON, cost: COST,
    kind: 'lifeLeech', leech: [0.05, 0.1, 0.25],
    description: [
      'Converts 5% of damage to HP with a chance of 100%.',
      'Converts 10% of damage to HP with a chance of 100%.',
      'Converts 25% of damage to HP with a chance of 100%.',
    ],
    reagents: reagents([['vampire teeth', 25, 25, 25], ['bloody pincers', 0, 15, 15], ['piece of dead brain', 0, 0, 5]]),
  },
  {
    id: 'void', name: 'Void', category: 'manaLeech', slots: WEAPON, cost: COST,
    kind: 'manaLeech', manaLeech: [0.03, 0.05, 0.08],
    description: [
      'Converts 3% of damage to MP with a chance of 100%.',
      'Converts 5% of damage to MP with a chance of 100%.',
      'Converts 8% of damage to MP with a chance of 100%.',
    ],
    reagents: reagents([['rope belt', 25, 25, 25], ['silencer claws', 0, 25, 25], ['some grimeleech wings', 0, 0, 5]]),
  },
  {
    id: 'chop', name: 'Chop', category: 'skillAxe', slots: WEAPON, cost: COST,
    kind: 'skill', skill: 'axe', bonus: [1, 2, 4],
    description: ['Raises axe fighting skill by 1.', 'Raises axe fighting skill by 2.', 'Raises axe fighting skill by 4.'],
    reagents: reagents([['orc tooth', 20, 20, 20], ['battle stone', 0, 25, 25], ['moohtant horn', 0, 0, 20]]),
  },
  {
    id: 'bash', name: 'Bash', category: 'skillClub', slots: WEAPON, cost: COST,
    kind: 'skill', skill: 'club', bonus: [1, 2, 4],
    description: ['Raises club fighting skill by 1.', 'Raises club fighting skill by 2.', 'Raises club fighting skill by 4.'],
    reagents: reagents([['cyclops toe', 20, 20, 20], ['ogre nose ring', 0, 15, 15], ["warmaster's wristguards", 0, 0, 10]]),
  },
  {
    id: 'slash', name: 'Slash', category: 'skillSword', slots: WEAPON, cost: COST,
    kind: 'skill', skill: 'sword', bonus: [1, 2, 4],
    description: ['Raises sword fighting skill by 1.', 'Raises sword fighting skill by 2.', 'Raises sword fighting skill by 4.'],
    reagents: reagents([["lion's mane", 25, 25, 25], ["mooh'tah shell", 0, 25, 25], ['war crystal', 0, 0, 5]]),
  },
  {
    id: 'precision', name: 'Precision', category: 'skillDistance', slots: WEAPON, cost: COST,
    kind: 'skill', skill: 'distance', bonus: [1, 2, 4],
    description: ['Raises distance fighting skill by 1.', 'Raises distance fighting skill by 2.', 'Raises distance fighting skill by 4.'],
    reagents: reagents([['elven scouting glass', 25, 25, 25], ['elven hoof', 0, 20, 20], ['metal spike', 0, 0, 10]]),
  },
  {
    id: 'punch', name: 'Punch', category: 'skillFist', slots: WEAPON, cost: COST,
    kind: 'skill', skill: 'fist', bonus: [1, 2, 4],
    description: ['Raises fist fighting skill by 1.', 'Raises fist fighting skill by 2.', 'Raises fist fighting skill by 4.'],
    // Crystal XML 40529 is missing from our items dump; CipSoft uses werehyaena talisman.
    reagents: reagents([['tarantula egg', 25, 25, 25], ['mantassin tail', 0, 20, 20], ['werehyaena talisman', 0, 0, 15]]),
  },
  {
    id: 'epiphany', name: 'Epiphany', category: 'skillMagic', slots: HEAD, cost: COST,
    kind: 'magic', magic: [1, 2, 4],
    description: ['Raises magic level by 1.', 'Raises magic level by 2.', 'Raises magic level by 4.'],
    reagents: reagents([['elvish talisman', 25, 25, 25], ['broken shamanic staff', 0, 15, 15], ['strand of medusa hair', 0, 0, 15]]),
  },
  {
    id: 'blockade', name: 'Blockade', category: 'skillShield', slots: [...HEAD, 'right'], cost: COST,
    kind: 'skill', skill: 'shield', bonus: [1, 2, 4],
    description: ['Raises shielding skill by 1.', 'Raises shielding skill by 2.', 'Raises shielding skill by 4.'],
    reagents: reagents([['piece of scarab shell', 20, 20, 20], ['brimstone shell', 0, 25, 25], ['frazzle skin', 0, 0, 25]]),
  },
  {
    id: 'swiftness', name: 'Swiftness', category: 'speed', slots: BOOTS, cost: COST,
    kind: 'speed', speed: [10, 15, 30],
    description: ['Raises walking speed by 10.', 'Raises walking speed by 15.', 'Raises walking speed by 30.'],
    reagents: reagents([['damselfly wing', 15, 15, 15], ['compass', 0, 25, 25], ['waspoid wing', 0, 0, 20]]),
  },
  {
    id: 'featherweight', name: 'Featherweight', category: 'capacity', slots: PACK, cost: COST,
    kind: 'capacity', capacity: [3, 8, 15],
    description: ['Raises capacity by 3%.', 'Raises capacity by 8%.', 'Raises capacity by 15%.'],
    reagents: reagents([['fairy wings', 20, 20, 20], ['little bowl of myrrh', 0, 10, 10], ['goosebump leather', 0, 0, 5]]),
  },
  {
    id: 'vibrancy', name: 'Vibrancy', category: 'vibrancy', slots: BOOTS, cost: COST,
    kind: 'vibrancy', chance: [15, 25, 50],
    description: [
      'Removes paralysis with a chance of 15%.',
      'Removes paralysis with a chance of 25%.',
      'Removes paralysis with a chance of 50%.',
    ],
    reagents: reagents([['wereboar hooves', 20, 20, 20], ['crystallized anger', 0, 15, 15], ['quill', 0, 0, 5]]),
  },
];

export function imbueReagentsFor(spec: ImbuementSpec, tier: number): Array<{ name: string; count: number }> {
  const index = Math.max(0, Math.min(2, tier - 1));
  return spec.reagents
    .map((reagent) => ({ name: reagent.name, count: reagent.counts[index] ?? 0 }))
    .filter((entry) => entry.count > 0);
}

export function activeImbueTier(character: CharacterState, id: string, now = Date.now()): number {
  const imbue = (character.imbuements ?? []).find((entry) => entry.type === id && entry.expiresAt > now);
  if (!imbue) return -1;
  return Math.min(2, Math.max(0, imbue.tier - 1));
}

export function imbueSkillBonus(character: CharacterState, skill: SkillName, now = Date.now()): number {
  let sum = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'skill' || spec.skill !== skill) continue;
    sum += spec.bonus[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0;
  }
  return sum;
}

export function imbueMagicBonus(character: CharacterState, now = Date.now()): number {
  let sum = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'magic') continue;
    sum += spec.magic[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0;
  }
  return sum;
}

export function imbueCapacityPercent(character: CharacterState, now = Date.now()): number {
  let sum = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'capacity') continue;
    sum += spec.capacity[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0;
  }
  return sum;
}

export function imbueSpeedBonus(character: CharacterState, now = Date.now()): number {
  let sum = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'speed') continue;
    sum += spec.speed[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0;
  }
  return sum;
}

export function imbueAbsorbPercent(character: CharacterState, damageType: CombatType, now = Date.now()): number {
  let sum = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'reduction' || spec.combat !== damageType) continue;
    sum += spec.percent[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0;
  }
  return sum;
}

/** Active elemental conversion on the weapon (Crystal: one damage imbue). */
export function imbueDamageConvert(
  character: CharacterState,
  now = Date.now(),
): { combat: CombatType; percent: number } | null {
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    if (entry.slot !== 'left' && entry.slot !== 'right') continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'convert') continue;
    return {
      combat: spec.combat,
      percent: spec.percent[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0,
    };
  }
  return null;
}

export function imbueVibrancyChance(character: CharacterState, now = Date.now()): number {
  let best = 0;
  for (const entry of character.imbuements ?? []) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((item) => item.id === entry.type);
    if (!spec || spec.kind !== 'vibrancy') continue;
    best = Math.max(best, spec.chance[Math.min(2, Math.max(0, entry.tier - 1))] ?? 0);
  }
  return best;
}

export function itemImbuementSlots(itemId: number | undefined): number {
  if (!itemId) return 0;
  return Math.max(0, itemsById.get(itemId)?.imbuementSlots ?? 0);
}

/** Free shrine index on an equipped piece, or -1 if full. */
export function nextImbueIndex(character: CharacterState, slot: EquipSlot, now = Date.now()): number {
  const max = itemImbuementSlots(character.equipment[slot]);
  if (max <= 0) return -1;
  const used = new Set(
    (character.imbuements ?? [])
      .filter((entry) => entry.slot === slot && entry.expiresAt > now)
      .map((entry) => entry.index ?? 0),
  );
  for (let index = 0; index < max; index += 1) {
    if (!used.has(index)) return index;
  }
  return -1;
}

export function normalizeImbueEntry(entry: ImbueSlot): ImbueSlot {
  return { ...entry, index: entry.index ?? 0 };
}
