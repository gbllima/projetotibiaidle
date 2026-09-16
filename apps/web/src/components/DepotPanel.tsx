import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { itemsById } from '@tibia-idle/data';
import { canEquipFor, DEPOT_SLOT_CAP, isConsumableItem, isEquipableItem, isSupplyItem } from '@tibia-idle/sim';
import { moveDepotToBackpack } from '../api/depot.js';
import type { CharacterView } from '../api/types.js';
import { formatNumber, itemValue } from '../format.js';
import { itemTooltipLines } from '../itemFormat.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

const DEPOT_UI_COLS = 5;
const DEPOT_UI_ROWS = 8;

type MenuState = {
  itemId: number;
  name: string;
  count: number;
  x: number;
  y: number;
};

type Props = {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function DepotPager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  return (
    <div className="pouch-pager">
      <button type="button" className="btn" disabled={page <= 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">‹</button>
      <span>{page + 1} / {pageCount}</span>
      <button type="button" className="btn" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)} aria-label="Próxima página">›</button>
    </div>
  );
}

export function DepotPanel({ character, busy, onClose, onAct }: Props) {
  const [view, setView] = useState(character);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inspectItemId, setInspectItemId] = useState<number | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView(character);
  }, [character]);

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

  const used = view.warehouse.length;
  const uiSlotsPerPage = DEPOT_UI_COLS * DEPOT_UI_ROWS;
  const uiPageCount = Math.ceil(DEPOT_SLOT_CAP / uiSlotsPerPage);
  const safePage = Math.min(Math.max(0, page), uiPageCount - 1);
  const start = safePage * uiSlotsPerPage;
  const pageStacks = view.warehouse.slice(start, start + uiSlotsPerPage);
  const emptySlots = Math.max(0, uiSlotsPerPage - pageStacks.length);

  const openMenu = (event: ReactMouseEvent, next: Omit<MenuState, 'x' | 'y'>) => {
    event.preventDefault();
    event.stopPropagation();
    setActionError('');
    setMenu({
      ...next,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 225)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
    });
  };

  const run = (body: Record<string, unknown>) => {
    setMenu(null);
    setActionError('');
    void onAct(body).catch((error) => {
      setActionError(error instanceof Error ? error.message : 'Falha ao executar a ação.');
    });
  };

  const inspect = (itemId: number) => {
    setMenu(null);
    setInspectItemId(itemId);
  };

  const moveToBackpack = async () => {
    if (!menu) return;
    const { itemId, count } = menu;
    setMenu(null);
    setActionError('');
    setTransferBusy(true);
    try {
      const next = await moveDepotToBackpack(view.id, itemId, count);
      setView(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Falha ao mover o item para a Backpack.');
    } finally {
      setTransferBusy(false);
    }
  };

  const def = menu ? itemsById.get(menu.itemId) : undefined;
  const consumable = def ? isConsumableItem(def) : false;
  const equipable = def ? isEquipableItem(def) : false;
  const supplyItem = def ? isSupplyItem(def) : false;
  const compatible = def ? canEquipFor(def, view.vocation.id, view.level) : false;
  const sellable = Boolean(def?.sellPrice);
  const unit = menu ? itemValue(menu.itemId) : 0;
  const disabled = busy || transferBusy;

  return <>
    <div className="modal" onClick={onClose}>
      <div className="modal-card wide depot-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead title="Depot" onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">
          <div className="compact-panel depot-panel">
            <div className="depot-toolbar">
              <button className="btn gold" disabled={disabled || view.warehouse.length === 0} onClick={() => void onAct({ type: 'warehouse-sell' })}>Coletar (vender tudo)</button>
              <DepotPager page={safePage} pageCount={uiPageCount} onChange={setPage} />
              <span className="compact-hint">{used}/{DEPOT_SLOT_CAP} · pág. {safePage + 1}/{uiPageCount}</span>
            </div>
            {actionError && <div className="error" style={{ marginBottom: 8 }}>{actionError}</div>}
            <div className="depot-grid-wrap">
              <div className="depot-grid">
                {pageStacks.map((stack) => (
                  <div className="depot-slot-entry" key={stack.itemId}>
                    <ItemSlot
                      itemId={stack.itemId}
                      count={stack.count}
                      label={stack.name}
                      onInspect={inspect}
                      onClick={(event) => openMenu(event, {
                        itemId: stack.itemId,
                        name: stack.name,
                        count: stack.count,
                      })}
                      onContextMenu={(event) => openMenu(event, {
                        itemId: stack.itemId,
                        name: stack.name,
                        count: stack.count,
                      })}
                    />
                  </div>
                ))}
                {Array.from({ length: emptySlots }, (_, index) => (
                  <div className="depot-slot-entry" key={`empty-${safePage}-${index}`}>
                    <ItemSlot />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="item-ctx"
          style={{ left: menu.x, top: menu.y, zIndex: 60 }}
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

          <button type="button" disabled={disabled} onClick={() => inspect(menu.itemId)}>Inspecionar</button>

          {equipable && !consumable && <>
            <div className="item-ctx-section">Equipar em</div>
            <button
              type="button"
              disabled={disabled || !compatible}
              title={!compatible ? 'Item incompatível com sua classe ou nível' : undefined}
              onClick={() => run({ type: 'equip', itemId: menu.itemId, source: 'warehouse' })}
            >
              Equipar em {view.name}
            </button>
          </>}

          {consumable && (
            <button type="button" disabled={disabled} onClick={() => run({ type: 'use-item', itemId: menu.itemId, source: 'warehouse' })}>
              Usar
            </button>
          )}

          {supplyItem ? (
            <button type="button" disabled={disabled} onClick={() => run({ type: 'warehouse-withdraw', itemId: menu.itemId, count: menu.count })}>
              Mover pra Supply
            </button>
          ) : (
            <button type="button" disabled={disabled} onClick={() => void moveToBackpack()}>
              Mover para Backpack
            </button>
          )}

          {sellable && (
            <button type="button" disabled={disabled} onClick={() => run({ type: 'sell-item', itemId: menu.itemId, source: 'warehouse', count: menu.count })}>
              Vender ({formatNumber(unit * menu.count)}g)
            </button>
          )}

          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={() => run({ type: 'destroy-item', itemId: menu.itemId, source: 'warehouse', count: menu.count })}
          >
            Destruir
          </button>
        </div>
      )}
    </div>

    {inspectItemId !== null && (
      <ItemInspectModal itemId={inspectItemId} onClose={() => setInspectItemId(null)} />
    )}
  </>;
}
