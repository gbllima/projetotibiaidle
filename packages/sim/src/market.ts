/**
 * Gold shop catalog — mirrors Crystal Server supply stash + common NPC shops
 * (Cornelia armor, Baltim weapons, rune/potion vendors).
 */

export interface MarketCategory {
  id: string;
  label: string;
  items: readonly string[];
}

export const MARKET_CATALOG: readonly MarketCategory[] = [
  {
    id: 'potions',
    label: 'Poções',
    items: [
      'health potion',
      'strong health potion',
      'great health potion',
      'ultimate health potion',
      'supreme health potion',
      'mana potion',
      'strong mana potion',
      'great mana potion',
      'ultimate mana potion',
      'superior mana potion',
      'great spirit potion',
      'ultimate spirit potion',
    ],
  },
  {
    id: 'runes',
    label: 'Runas',
    items: [
      'blank rune',
      'light magic missile rune',
      'heavy magic missile rune',
      'fireball rune',
      'great fireball rune',
      'explosion rune',
      'sudden death rune',
      'avalanche rune',
      'thunderstorm rune',
      'stone shower rune',
      'icicle rune',
      'stalagmite rune',
      'holy missile rune',
      'intense healing rune',
      'ultimate healing rune',
      'cure poison rune',
      'destroy field rune',
      'fire field rune',
      'poison field rune',
      'energy field rune',
      'fire wall rune',
      'poison wall rune',
      'energy wall rune',
      'magic wall rune',
      'fire bomb rune',
      'poison bomb rune',
      'energy bomb rune',
      'soulfire rune',
      'wild growth rune',
      'paralyse rune',
      'convince creature rune',
      'chameleon rune',
      'disintegrate rune',
      'animate dead rune',
    ],
  },
  {
    id: 'distance',
    label: 'Distância',
    items: [
      // Spears / thrown
      'spear',
      'hunting spear',
      'royal spear',
      'enchanted spear',
      'mean paladin spear',
      'glooth spear',
      'throwing star',
      'assassin star',
      'throwing knife',
      // Basic ammo
      'simple arrow',
      'arrow',
      'poison arrow',
      'burst arrow',
      'bolt',
      'power bolt',
      'piercing bolt',
      'vortex bolt',
      'drill bolt',
      'prismatic bolt',
      'infernal bolt',
      'crystal bolt',
      'spectral bolt',
      // Elemental arrows
      'flash arrow',
      'shiver arrow',
      'flaming arrow',
      'earth arrow',
      'envenomed arrow',
      // Physical specials
      'sniper arrow',
      'onyx arrow',
      'tarsal arrow',
      'crystalline arrow',
      // AoE / storm
      'shatterstorm arrow',
      'firestorm arrow',
      'terrastorm arrow',
      'froststorm arrow',
      'thunderstorm arrow',
      'diamond arrow',
      // Bows / quivers
      'bow',
      'quiver',
    ],
  },
  {
    id: 'armor',
    label: 'Armaduras',
    items: [
      'leather helmet',
      'leather armor',
      'leather legs',
      'leather boots',
      'studded helmet',
      'studded armor',
      'studded legs',
      'studded shield',
      'brass helmet',
      'brass armor',
      'brass legs',
      'brass shield',
      'chain helmet',
      'chain armor',
      'chain legs',
      'scale armor',
      'soldier helmet',
      'viking helmet',
      'iron helmet',
      'steel helmet',
      'plate armor',
      'plate shield',
      'steel shield',
      'dwarven shield',
      'wooden shield',
      'viking shield',
    ],
  },
  {
    id: 'weapons',
    label: 'Armas',
    items: [
      'club',
      'dagger',
      'hand axe',
      'axe',
      'sabre',
      'sword',
      'short sword',
      'rapier',
      'mace',
      'longsword',
      'bone sword',
      'battle axe',
      'battle hammer',
      'morning star',
      'carlin sword',
      'spike sword',
    ],
  },
  {
    id: 'mage',
    label: 'Mago',
    items: [
      'snakebite rod',
      'moonlight rod',
      'necrotic rod',
      'northwind rod',
      'wand of vortex',
      'wand of dragonbreath',
      'wand of decay',
      'wand of cosmic energy',
      'spellbook',
    ],
  },
  {
    id: 'rings',
    label: 'Anéis',
    items: [
      'life ring',
      'ring of healing',
      'time ring',
      'energy ring',
      'sword ring',
      'axe ring',
      'club ring',
      'dwarven ring',
      'stealth ring',
      'might ring',
    ],
  },
  {
    id: 'amulets',
    label: 'Amuletos',
    items: [
      'protection amulet',
      'bronze amulet',
      'silver amulet',
      'stone skin amulet',
      'amulet of loss',
      'garlic necklace',
      'elven amulet',
    ],
  },
  {
    id: 'tools',
    label: 'Utilidades',
    items: [
      'backpack',
      'torch',
      'crowbar',
      'fishing rod',
      'worm',
      'rope',
      'shovel',
      'pick',
    ],
  },
  {
    id: 'exercise',
    label: 'Exercise',
    items: [
      'exercise sword',
      'exercise axe',
      'exercise club',
      'exercise bow',
      'exercise rod',
      'exercise wand',
      'exercise shield',
    ],
  },
];

let marketNames: Set<string> | null = null;

function marketItemNames(): Set<string> {
  if (!marketNames) {
    marketNames = new Set<string>();
    for (const category of MARKET_CATALOG) {
      for (const name of category.items) marketNames.add(name.toLowerCase());
    }
  }
  return marketNames;
}

export function flattenMarketWares(): string[] {
  return MARKET_CATALOG.flatMap((category) => category.items);
}

/** @deprecated Use flattenMarketWares() — kept for existing imports. */
export const NPC_WARES = flattenMarketWares();

export function marketCategoryForItem(name: string): string {
  const lower = name.toLowerCase();
  for (const category of MARKET_CATALOG) {
    if (category.items.some((entry) => entry.toLowerCase() === lower)) return category.id;
  }
  return 'other';
}

export function isMarketItem(name: string): boolean {
  return marketItemNames().has(name.toLowerCase());
}

/**
 * NPC buy prices for ammo/spears missing `buyPrice` in items.xml.
 * Crystal still sells these; the idle merchant needs a gold cost.
 */
const MARKET_BUY_FALLBACK: Record<string, number> = {
  'simple arrow': 2,
  'poison arrow': 12,
  'diamond arrow': 130,
  'spectral bolt': 70,
  'crystal bolt': 20,
  'royal spear': 15,
  'mean paladin spear': 30,
  'glooth spear': 40,
  'throwing knife': 25,
};

/** Effective gold cost to buy from the NPC market. */
export function marketBuyPrice(item: { name: string; buyPrice: number | null }): number | null {
  if (item.buyPrice !== null && item.buyPrice > 0) return item.buyPrice;
  return MARKET_BUY_FALLBACK[item.name.toLowerCase()] ?? null;
}
