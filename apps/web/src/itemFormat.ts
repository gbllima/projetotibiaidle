import { itemsById, wandsById, type Item } from '@tibia-idle/data';
import { ITEM_MARKET_CATEGORIES } from '@tibia-idle/sim';
import { formatNumber } from './format.js';

export const BONUS_LABELS: Record<string, string> = {
  skillsword: 'sword fighting',
  skillaxe: 'axe fighting',
  skillclub: 'club fighting',
  skilldist: 'distance fighting',
  skillfist: 'fist fighting',
  skillshield: 'shielding',
  magiclevelpoints: 'magic level',
  criticalhitchance: 'crit chance',
  criticalhitdamage: 'crit extra damage',
  lifeleechchance: 'life leech chance',
  lifeleechamount: 'life leech amount',
  manaleechchance: 'mana leech chance',
  manaleechamount: 'mana leech amount',
  healthgain: 'HP regen',
  healthticks: 'HP regen ticks',
  managain: 'MP regen',
  manaticks: 'MP regen ticks',
  speed: 'speed',
  absorbpercentphysical: 'protection physical',
  absorbpercentfire: 'protection fire',
  absorbpercentice: 'protection ice',
  absorbpercentearth: 'protection earth',
  absorbpercentenergy: 'protection energy',
  absorbpercentholy: 'protection holy',
  absorbpercentdeath: 'protection death',
  absorbpercentall: 'protection all',
  elementfire: 'fire attack',
  elementice: 'ice attack',
  elementearth: 'earth attack',
  elementenergy: 'energy attack',
  elementholy: 'holy attack',
  elementdeath: 'death attack',
};

const TYPE_TO_MARKET: Record<string, number> = {
  armors: 1,
  'amulets and necklaces': 2,
  boots: 3,
  containers: 4,
  'creature products': 24,
  decoration: 5,
  food: 6,
  helmets: 7,
  'helmets and hats': 7,
  legs: 8,
  liquids: 10,
  potions: 10,
  quivers: 25,
  rings: 11,
  'attack runes': 12,
  'healing runes': 12,
  'support runes': 12,
  runes: 12,
  shields: 13,
  spellbooks: 13,
  tools: 14,
  valuables: 15,
  ammunition: 16,
  'axe weapons': 17,
  'club weapons': 18,
  'distance weapons': 19,
  'sword weapons': 20,
  wands: 21,
  rods: 21,
};

export function itemMarketCategory(item: Item): number {
  if (item.marketCategory != null) return item.marketCategory;
  const type = (item.type ?? '').toLowerCase();
  if (TYPE_TO_MARKET[type] != null) return TYPE_TO_MARKET[type]!;
  if (item.weaponType === 'sword') return 20;
  if (item.weaponType === 'axe') return 17;
  if (item.weaponType === 'club') return 18;
  if (item.weaponType === 'distance') return 19;
  if (item.weaponType === 'wand') return 21;
  if (item.weaponType === 'shield') return 13;
  if (item.weaponType === 'ammunition') return 16;
  if (item.runeSpellName) return 12;
  return 31;
}

export function formatBonus(key: string, value: number): string {
  const label = BONUS_LABELS[key] ?? key;
  if (key.startsWith('absorbpercent') || key.includes('chance') || key.includes('amount')) {
    return `${label} ${value > 0 ? '+' : ''}${value}%`;
  }
  if (key.startsWith('element')) return `Atk ${value} ${label.replace(' attack', '')}`;
  return `${label} ${value > 0 ? '+' : ''}${value}`;
}

export function itemCategoryName(item: Item): string {
  return ITEM_MARKET_CATEGORIES.find((entry) => entry.id === itemMarketCategory(item))?.name
    ?? item.type
    ?? 'item';
}

export function itemWeightOz(item: Item): string {
  return `${(item.weight / 100).toFixed(2)} oz`;
}

export function itemLevelRequired(item: Item): number {
  const wand = wandsById.get(item.id);
  return Math.max(item.levelRequired, wand?.levelRequired ?? 0);
}

export function itemStatLine(item: Item): string | null {
  const wand = wandsById.get(item.id);
  const parts: string[] = [];
  if (item.attack > 0 || item.defense > 0 || item.armor > 0 || item.extraDefense > 0) {
    parts.push(`Atk ${item.attack} · Def ${item.defense}${item.extraDefense > 0 ? `+${item.extraDefense}` : ''} · Arm ${item.armor}`);
  }
  if (wand) parts.push(`Dmg ${wand.fromDamage}–${wand.toDamage} · Mana ${wand.mana}`);
  if (item.range > 0) parts.push(`Range ${item.range}`);
  if (item.hitChance != null) parts.push(`Hit ${item.hitChance}%`);
  if (item.containerSize != null) parts.push(`Cap ${item.containerSize}`);
  if (item.charges != null) parts.push(`${item.charges} charges`);
  if (item.runeSpellName) parts.push(item.runeSpellName);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Compact lines for hover tooltips and context-menu headers. */
export function itemTooltipLines(itemId: number): string[] {
  const item = itemsById.get(itemId);
  if (!item) return ['Item desconhecido.'];

  const lines: string[] = [];
  const category = itemCategoryName(item);
  lines.push(category);
  lines.push(`Peso: ${itemWeightOz(item)}`);

  const stats = itemStatLine(item);
  if (stats) lines.push(stats);

  const level = itemLevelRequired(item);
  if (level > 0) lines.push(`Level ${level}+`);
  if (item.vocations.length > 0) lines.push(`Vocação: ${item.vocations.join(', ')}`);
  if (item.slot) lines.push(`Slot: ${item.slot}`);
  if (item.weaponType) lines.push(`Tipo: ${item.weaponType}`);

  const bonuses = Object.entries(item.bonuses).slice(0, 6);
  for (const [key, value] of bonuses) lines.push(formatBonus(key, value));
  if (Object.keys(item.bonuses).length > 6) {
    lines.push(`+${Object.keys(item.bonuses).length - 6} bônus…`);
  }

  if (item.sellPrice) lines.push(`Vende: ${formatNumber(item.sellPrice)}g`);
  if (item.buyPrice) lines.push(`Compra: ${formatNumber(item.buyPrice)}g`);

  return lines;
}

export function itemDisplayName(item: Item): string {
  return item.article ? `${item.article} ${item.name}` : item.name;
}
