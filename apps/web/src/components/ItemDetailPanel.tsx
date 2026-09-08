import { wandsById, type Item } from '@tibia-idle/data';
import {
  formatBonus,
  itemCategoryName,
  itemDisplayName,
  itemLevelRequired,
  itemWeightOz,
} from '../itemFormat.js';
import { formatNumber } from '../format.js';
import { ItemSlot } from './ItemSlot.js';

export function ItemDetailPanel({ item, compact }: { item: Item; compact?: boolean }) {
  const wand = wandsById.get(item.id);
  const bonuses = Object.entries(item.bonuses);
  const category = itemCategoryName(item);
  const level = itemLevelRequired(item);

  return (
    <div className={`compact-detail${compact ? ' compact-detail-inline' : ''}`}>
      <ItemSlot itemId={item.id} label={item.name} compact showInfo={false} />
      <h3>{itemDisplayName(item)}</h3>
      {item.description && (
        <p className="lede item-detail-desc">{item.description}</p>
      )}
      <div className="kv">
        <span>Categoria</span><strong>{category}</strong>
        <span>Peso</span><strong>{itemWeightOz(item)}</strong>
        {(item.attack > 0 || item.defense > 0 || item.armor > 0 || item.extraDefense > 0) && (
          <>
            <span>Atk / Def / Arm</span>
            <strong>
              {item.attack}
              {' / '}
              {item.defense}{item.extraDefense > 0 ? `+${item.extraDefense}` : ''}
              {' / '}
              {item.armor}
            </strong>
          </>
        )}
        {wand && (
          <>
            <span>Wand dmg</span><strong>{wand.fromDamage}–{wand.toDamage}</strong>
            <span>Mana</span><strong>{wand.mana}</strong>
            {wand.shootType && <><span>Shoot</span><strong>{wand.shootType}</strong></>}
          </>
        )}
        {item.range > 0 && <><span>Range</span><strong>{item.range}</strong></>}
        {item.hitChance != null && <><span>Hit chance</span><strong>{item.hitChance}%</strong></>}
        {item.ammoType && <><span>Ammo</span><strong>{item.ammoType}</strong></>}
        {item.shootType && !wand && <><span>Shoot</span><strong>{item.shootType}</strong></>}
        {item.containerSize != null && <><span>Capacidade</span><strong>{item.containerSize}</strong></>}
        {item.charges != null && <><span>Cargas</span><strong>{item.charges}</strong></>}
        {item.duration != null && <><span>Duração</span><strong>{item.duration}s</strong></>}
        {item.runeSpellName && <><span>Rune</span><strong>{item.runeSpellName}</strong></>}
        {item.imbuementSlots > 0 && <><span>Imbuements</span><strong>{item.imbuementSlots} slots</strong></>}
        {level > 0 && <><span>Level</span><strong>{level}</strong></>}
        {item.vocations.length > 0 && <><span>Vocação</span><strong>{item.vocations.join(', ')}</strong></>}
        {item.slot && <><span>Slot</span><strong>{item.slot}</strong></>}
        {item.weaponType && <><span>Weapon</span><strong>{item.weaponType}</strong></>}
        <span>Stackable</span><strong>{item.stackable ? 'sim' : 'não'}</strong>
        <span>Comprar (NPC)</span><strong>{item.buyPrice ? `${formatNumber(item.buyPrice)}g` : '—'}</strong>
        <span>Vender (NPC)</span><strong>{item.sellPrice ? `${formatNumber(item.sellPrice)}g` : '—'}</strong>
        {bonuses.map(([key, value]) => (
          <span key={key} className="item-bonus-line">{formatBonus(key, value)}</span>
        ))}
      </div>
    </div>
  );
}
