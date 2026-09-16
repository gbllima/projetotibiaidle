import { itemRarity, type ItemRarity } from '../format.js';
import './ItemRarityBadge.css';

const RARITY_LABELS: Record<Exclude<ItemRarity, 'common'>, string> = {
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
};

export function visibleItemRarity(itemId: number): Exclude<ItemRarity, 'common'> | null {
  const rarity = itemRarity(itemId);
  return rarity === 'common' ? null : rarity;
}

export function ItemRarityBadge({ itemId }: { itemId: number }) {
  const rarity = visibleItemRarity(itemId);
  if (!rarity) return null;

  return (
    <div className={`item-rarity-badge ${rarity}`} aria-label={`Raridade ${RARITY_LABELS[rarity]}`}>
      <span>Raridade</span>
      <strong>{RARITY_LABELS[rarity]}</strong>
    </div>
  );
}
