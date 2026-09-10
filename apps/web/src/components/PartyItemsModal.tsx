import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { itemsById } from '@tibia-idle/data';
import { canEquipFor, isConsumableItem, isEquipableItem } from '@tibia-idle/sim';
import { api } from '../api/client.js';
import type { CharacterView } from '../api/types.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

type ItemSource = 'worn' | 'backpack';
type MenuState = {
  itemId: number;
  name: string;
  count: number;
  from: ItemSource;
  slot?: string;
  x: number;
  y: number;
};

type Props = {
  character: CharacterView;
  busy?: boolean;
  onClose: () => void;
};

export function PartyItemsModal({ character, busy = false, onClose }: Props) {
  const [view, setView] = useState(character);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inspectItemId, setInspectItemId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setView(character), [character]);

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

  const backpack = view.backpackContents ?? [];
  const capacity = view.backpackCapacity ?? backpack.length;
  const locked = busy || actionBusy;
  const menuDef = menu ? itemsById.get(menu.itemId) : undefined;
  const menuConsumable = menuDef ? isConsumableItem(menuDef) : false;
  const menuEquipable = menuDef ? isEquipableItem(menuDef) : false;
  const menuCompatible = menuDef ? canEquipFor(menuDef, view.vocation.id, view.level) : false;

  const openMenu = (event: ReactMouseEvent, next: Omit<MenuState, 'x' | 'y'>) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 190);
    const y = Math.min(event.clientY, window.innerHeight - 200);
    setMenu({ ...next, x: Math.max(8, x), y: Math.max(8, y) });
  };

  const refresh = async () => {
    const result = await api.character(view.id);
    setView(result.character);
    return result.character;
  };

  const runAction = async (work: () => Promise<unknown>) => {
    if (locked) return;
    setMenu(null);
    setError('');
    setActionBusy(true);
    try {
      await work();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.');
    } finally {
      setActionBusy(false);
    }
  };

  const inspect = (itemId: number) => {
    setMenu(null);
    setInspectItemId(itemId);
  };

  return <>
    <div className="modal" onClick={onClose}>
      <div className="modal-card party-items-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead title={`Itens — ${view.name}`} onClose={onClose} closeLabel="Fechar" />
        {error && <div className="party-items-error" role="alert">{error}</div>}
        <div className="party-items-body">
          <section className="party-items-equipment" aria-label={`Equipamentos de ${view.name}`}>
            <div className="party-items-paperdoll">
              {PAPERDOLL_SLOTS.map((slot) => {
                const equipped = view.equipment?.[slot.id];
                return <div className={`paper-slot ${slot.area}`} key={slot.id} title={equipped?.name ?? slot.id}>
                  <ItemSlot
                    itemId={equipped?.id}
                    label={equipped?.name}
                    compact
                    emptyLabel={slot.id === 'necklace' ? 'Amuleto' : slot.id === 'ring' ? 'Anel' : slot.id === 'ammo' ? 'Berloque' : undefined}
                    onInspect={equipped ? inspect : undefined}
                    onClick={equipped ? (event) => openMenu(event, {
                      itemId: equipped.id,
                      name: equipped.name,
                      count: 1,
                      from: 'worn',
                      slot: slot.id,
                    }) : undefined}
                    onContextMenu={equipped ? (event) => openMenu(event, {
                      itemId: equipped.id,
                      name: equipped.name,
                      count: 1,
                      from: 'worn',
                      slot: slot.id,
                    }) : undefined}
                  />
                </div>;
              })}
            </div>
            <div className="party-items-stats">
              <span>Soul <b>{view.soul ?? 0}</b></span>
              <span>Cap <b>{Math.round(view.stats?.capacity ?? 0)}</b></span>
            </div>
          </section>

          <section className="party-items-backpack">
            <div className="party-items-tabs">
              <button type="button" className="on">Backpack</button>
              <button type="button" disabled>Loot Pouch</button>
              <button type="button" disabled>Store Inbox</button>
            </div>
            <p>Backpack {backpack.length} / {capacity} — itens guardados pelo personagem.</p>
            <div className="party-items-grid">
              {Array.from({ length: Math.max(20, Math.min(40, capacity)) }, (_, index) => {
                const stack = backpack[index];
                return <ItemSlot
                  key={stack ? `party-bp-${stack.itemId}-${index}` : `party-bp-empty-${index}`}
                  itemId={stack?.itemId}
                  count={stack?.count ?? 0}
                  label={stack?.name ?? (stack ? itemsById.get(stack.itemId)?.name : undefined)}
                  compact
                  onInspect={stack ? inspect : undefined}
                  onClick={stack ? (event) => openMenu(event, {
                    itemId: stack.itemId,
                    name: stack.name ?? itemsById.get(stack.itemId)?.name ?? 'Item',
                    count: stack.count,
                    from: 'backpack',
                  }) : undefined}
                  onContextMenu={stack ? (event) => openMenu(event, {
                    itemId: stack.itemId,
                    name: stack.name ?? itemsById.get(stack.itemId)?.name ?? 'Item',
                    count: stack.count,
                    from: 'backpack',
                  }) : undefined}
                />;
              })}
            </div>
          </section>
        </div>
        <footer className="party-items-footer">
          <span className="party-items-help">Clique ou botão direito em um item para abrir as ações.</span>
          <button type="button" className="btn" disabled={locked} onClick={onClose}>Fechar</button>
        </footer>
      </div>

      {menu && <div
        ref={menuRef}
        className="party-item-context"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="party-item-context-title">{menu.name}</div>
        <button type="button" disabled={locked} onClick={() => inspect(menu.itemId)}>⌕ <span>Inspecionar</span></button>
        {menu.from === 'backpack' && menuEquipable && !menuConsumable && (
          <button
            type="button"
            disabled={locked || !menuCompatible}
            title={!menuCompatible ? 'Item incompatível com a vocação ou nível deste personagem' : undefined}
            onClick={() => void runAction(() => api.act(view.id, {
              type: 'equip',
              itemId: menu.itemId,
              source: 'backpack',
            }))}
          >⇧ <span>Equipar</span></button>
        )}
        {menu.from === 'worn' && menu.slot && menu.slot !== 'backpack' && (
          <button type="button" disabled={locked} onClick={() => void runAction(() => api.act(view.id, { type: 'unequip', slot: menu.slot! }))}>↗ <span>Desequipar</span></button>
        )}
        {menu.from === 'worn' && menu.slot === 'backpack' && backpack.length === 0 && (
          <button type="button" disabled={locked} onClick={() => void runAction(() => api.act(view.id, { type: 'unequip', slot: 'backpack' }))}>↗ <span>Desequipar</span></button>
        )}
        <button type="button" className="danger" disabled={locked} onClick={() => void runAction(() => api.act(view.id, {
          type: 'destroy-item',
          itemId: menu.itemId,
          source: menu.from,
          count: menu.count,
          slot: menu.slot,
        }))}>⌫ <span>Destruir</span></button>
      </div>}
    </div>

    {inspectItemId !== null && <ItemInspectModal itemId={inspectItemId} onClose={() => setInspectItemId(null)} />}
  </>;
}
