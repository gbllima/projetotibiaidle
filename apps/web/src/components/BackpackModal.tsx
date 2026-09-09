import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { itemsById } from '@tibia-idle/data';
import { canEquipFor, isConsumableItem, isEquipableItem } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { formatNumber, itemRarity, itemValue } from '../format.js';
import { itemTooltipLines } from '../itemFormat.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

type MenuState = {
  itemId: number;
  name: string;
  count: number;
  x: number;
  y: number;
};

function padStacks<T extends { itemId: number; count: number; name: string }>(
  items: T[],
  size: number,
): Array<T | { itemId: 0; count: 0; name: '' }> {
  const next: Array<T | { itemId: 0; count: 0; name: '' }> = items.slice(0, size);
  const empty = { itemId: 0, count: 0, name: '' } as const;
  while (next.length < size) next.push(empty);
  return next;
}

export function BackpackModal({
  character,
  busy,
  onClose,
  onEquip,
  onUnequip,
  onWithdraw,
  onSellItem,
  onDestroyItem,
  onUseItem,
  onInspect,
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onEquip: (itemId: number) => void;
  onUnequip: () => void;
  onWithdraw: (itemId: number, count: number, target: 'supply' | 'warehouse') => void;
  onSellItem: (itemId: number, count: number) => void;
  onDestroyItem: (itemId: number, count: number) => void;
  onUseItem: (itemId: number) => void;
  onInspect?: (itemId: number) => void;
}) {
  const worn = character.equipment.backpack;
  const capacity = character.backpackCapacity ?? 20;
  const stacks = character.backpackContents.filter((stack) => stack.count > 0);
  const slots = padStacks(stacks, capacity);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (event: ReactMouseEvent, next: Omit<MenuState, 'x' | 'y'>) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 180);
    const y = Math.min(event.clientY, window.innerHeight - 260);
    setMenu({ ...next, x: Math.max(8, x), y: Math.max(8, y) });
  };

  const run = (action: () => void) => {
    setMenu(null);
    action();
  };

  const def = menu ? itemsById.get(menu.itemId) : null;
  const consumable = def ? isConsumableItem(def) : false;
  const equipable = def ? isEquipableItem(def) : false;
  const compatible = def ? canEquipFor(def, character.vocation.id, character.level) : false;
  const sellable = Boolean(def?.sellPrice);
  const unit = menu ? itemValue(menu.itemId) : 0;
  const canUnequip = stacks.length === 0;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card compact-modal backpack-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead
          title={worn?.name ?? 'Backpack'}
          extra={<span>{stacks.length} / {capacity} slots</span>}
          onClose={onClose}
          closeLabel="Fechar"
        />
        <div className="modal-card-body">
        <div className="backpack-grid">
          {slots.map((item, index) => (
            <ItemSlot
              key={item.itemId ? `bp-${item.itemId}` : `bp-empty-${index}`}
              itemId={item.itemId || undefined}
              count={item.count}
              label={item.name || itemsById.get(item.itemId)?.name}
              rarity={item.itemId ? itemRarity(item.itemId) : undefined}
              onInspect={item.itemId && onInspect ? onInspect : undefined}
              onClick={(event) => item.itemId && openMenu(event, {
                itemId: item.itemId,
                name: item.name,
                count: item.count,
              })}
            />
          ))}
        </div>
        <div className="box-tools">
          <button
            className="btn"
            disabled={busy || !canUnequip}
            title={canUnequip ? undefined : 'Esvazie a backpack antes de desequipar'}
            onClick={() => onUnequip()}
          >
            Desequipar
          </button>
        </div>
        </div>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="item-ctx"
          style={{ left: menu.x, top: menu.y, zIndex: 50 }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="item-ctx-head">
            <strong>{menu.name}</strong>
            <span>×{menu.count}{unit ? ` · ${formatNumber(unit * menu.count)}g` : ''}</span>
            <div className="item-ctx-stats">
              {itemTooltipLines(menu.itemId).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          </div>
          {onInspect && (
            <button type="button" disabled={busy} onClick={() => run(() => onInspect(menu.itemId))}>Inspecionar</button>
          )}
          {equipable && !consumable && (
            <button type="button" disabled={busy || !compatible} title={!compatible ? 'Item incompatível com sua classe ou nível' : undefined} onClick={() => run(() => onEquip(menu.itemId))}>Equipar</button>
          )}
          {consumable && (
            <button type="button" disabled={busy} onClick={() => run(() => onUseItem(menu.itemId))}>Usar</button>
          )}
          <button type="button" disabled={busy} onClick={() => run(() => onWithdraw(menu.itemId, menu.count, 'supply'))}>
            Mover pra supply
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => onWithdraw(menu.itemId, menu.count, 'warehouse'))}>
            Mover pro armazém
          </button>
          {sellable && (
            <button type="button" disabled={busy} onClick={() => run(() => onSellItem(menu.itemId, menu.count))}>
              Vender ({formatNumber(unit * menu.count)}g)
            </button>
          )}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => run(() => onDestroyItem(menu.itemId, menu.count))}
          >
            Destruir
          </button>
        </div>
      )}
    </div>
  );
}
