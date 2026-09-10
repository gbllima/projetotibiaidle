import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { itemsById } from '@tibia-idle/data';
import { canEquipFor, isConsumableItem, isEquipableItem, LOOT_SLOT_CAP, LOOT_SLOT_DEFAULT, POUCH_SLOTS_PER_PAGE, SUPPLY_SLOT_CAP } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { api } from '../api/client.js';
import { itemRarity, itemValue, formatNumber } from '../format.js';
import { itemTooltipLines } from '../itemFormat.js';
import { useLocale } from '../i18n/Locale.js';
import { BlessingModal } from './BlessingModal.js';
import { DockBox } from './DockBox.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';
import { PartyManagerModal } from './PartyManagerModal.js';
import { PartyPanel } from './PartyPanel.js';

type ItemSource = 'pouch' | 'supply' | 'backpack';
type SlotCurrency = 'gold' | 'coins';
type StackView = { itemId: number; name: string; count: number };
type PartyEquipTarget = { id: number; name: string; level: number; vocationId: number };

type MenuState = {
  itemId: number;
  name: string;
  count: number;
  from: ItemSource;
  x: number;
  y: number;
};

type Props = {
  character: CharacterView;
  busy: boolean;
  onSell: () => void;
  onUpgrade: () => void;
  onParty: () => void;
  onRemoveParty: (characterId: number) => void;
  onOutfit: () => void;
  onLootSlot: (currency: SlotCurrency) => void;
  onSupplySlot: (currency: SlotCurrency) => void;
  onLootFilter: (value: number) => void;
  onEquip: (itemId: number, source: 'pouch' | 'warehouse' | 'supply' | 'backpack', targetCharacterId?: number) => void;
  onUnequip: (slot: string, targetCharacterId?: number) => void;
  onDestroyItem: (itemId: number, source: 'worn' | ItemSource, count: number, slot?: string) => void;
  onSellItem: (itemId: number, source: ItemSource, count: number) => void;
  onMoveItem: (itemId: number, source: 'pouch' | 'supply', count: number) => void;
  onUseItem: (itemId: number, source: ItemSource) => void;
  onBackpackWithdraw: (itemId: number, count: number, target: 'supply' | 'warehouse') => void;
  onBlessing: (body: { blessIndex?: number; buyAll?: boolean }) => Promise<void>;
};

function pad<T>(items: T[], size: number, empty: T): T[] {
  const next = items.slice(0, size);
  while (next.length < size) next.push(empty);
  return next;
}

function byValue<T extends { itemId: number }>(items: T[], rare: boolean): T[] {
  if (!rare) return items;
  return [...items].sort((a, b) => itemValue(b.itemId) - itemValue(a.itemId));
}

function paginateSlots<T>(items: T[], totalSlots: number, page: number, empty: T) {
  const pageCount = Math.max(1, Math.ceil(totalSlots / POUCH_SLOTS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * POUCH_SLOTS_PER_PAGE;
  const onPage = Math.min(POUCH_SLOTS_PER_PAGE, totalSlots - start);
  return { visible: pad(items.slice(start, start + onPage), onPage, empty), pageCount, safePage };
}

function PouchPager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return <div className="pouch-pager">
    <button type="button" className="btn" disabled={page <= 0} onClick={() => onChange(page - 1)}>‹</button>
    <span>{page + 1} / {pageCount}</span>
    <button type="button" className="btn" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)}>›</button>
  </div>;
}

export function RightDock({
  character,
  busy,
  onSell,
  onParty,
  onLootSlot,
  onSupplySlot,
  onLootFilter,
  onEquip,
  onDestroyItem,
  onSellItem,
  onMoveItem,
  onUseItem,
  onBackpackWithdraw,
  onBlessing,
}: Props) {
  const { t } = useLocale();
  const [view, setView] = useState(character);
  const [rare, setRare] = useState(false);
  const [partyManagerOpen, setPartyManagerOpen] = useState(false);
  const [partyView, setPartyView] = useState(character);
  const [partyBusy, setPartyBusy] = useState(false);
  const [blessOpen, setBlessOpen] = useState(false);
  const [lootPage, setLootPage] = useState(0);
  const [supplyPage, setSupplyPage] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inspectItemId, setInspectItemId] = useState<number | null>(null);
  const [ignoredItemIds, setIgnoredItemIds] = useState<number[]>([]);
  const [lootActionBusy, setLootActionBusy] = useState(false);
  const [lootActionError, setLootActionError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView(character);
    setPartyView(character);
  }, [character]);

  useEffect(() => {
    let cancelled = false;
    void api.lootPreferences(character.id)
      .then((result) => { if (!cancelled) setIgnoredItemIds(result.ignoredItemIds); })
      .catch(() => { if (!cancelled) setIgnoredItemIds([]); });
    return () => { cancelled = true; };
  }, [character.id]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const lootSlots = view.lootSlots ?? LOOT_SLOT_DEFAULT;
  const supplySlots = view.supplySlots ?? 20;
  const lootSlotCost = view.lootSlotCost ?? 10_000;
  const lootSlotCoinCost = view.lootSlotCoinCost ?? 10;
  const supplySlotCost = view.supplySlotCost ?? 10_000;
  const supplySlotCoinCost = view.supplySlotCoinCost ?? 10;
  const empty: StackView = { itemId: 0, name: '', count: 0 };
  const lootItems = view.session?.loot ?? [];
  const lootAll = pad(byValue(lootItems.filter((item) => !ignoredItemIds.includes(item.itemId)), rare), lootSlots, empty);
  const supplyAll = pad(byValue(view.supplies.filter((stack) => stack.count > 0), rare), supplySlots, empty);
  const lootPaged = paginateSlots(lootAll, lootSlots, lootPage, empty);
  const supplyPaged = paginateSlots(supplyAll, supplySlots, supplyPage, empty);
  const backpackCapacity = Math.max(1, view.backpackCapacity ?? 20);
  const backpackItems = byValue(view.backpackContents.filter((stack) => stack.count > 0).map((stack) => ({
    ...stack,
    name: itemsById.get(stack.itemId)?.name ?? `#${stack.itemId}`,
  })), rare);
  const backpackSlots = pad(backpackItems, backpackCapacity, empty);

  const partyIds = partyView.partyMemberIds ?? [partyView.id];
  const partyEquipTargets: PartyEquipTarget[] = partyIds.map((id) => {
    if (id === view.id) return { id: view.id, name: view.name, level: view.level, vocationId: view.vocation.id };
    const mate = partyView.caveParty.find((entry) => entry.id === id);
    return mate ? { id: mate.id, name: mate.name, level: mate.level, vocationId: mate.vocationId } : null;
  }).filter((entry): entry is PartyEquipTarget => entry !== null);

  useEffect(() => {
    if (lootPage !== lootPaged.safePage) setLootPage(lootPaged.safePage);
  }, [lootPage, lootPaged.safePage]);
  useEffect(() => {
    if (supplyPage !== supplyPaged.safePage) setSupplyPage(supplyPaged.safePage);
  }, [supplyPage, supplyPaged.safePage]);

  const openMenu = (event: ReactMouseEvent, next: Omit<MenuState, 'x' | 'y'>) => {
    event.preventDefault();
    event.stopPropagation();
    setLootActionError('');
    setMenu({
      ...next,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 225)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
    });
  };

  const run = (action: () => void) => {
    setMenu(null);
    action();
  };

  const inspect = (itemId: number) => {
    setMenu(null);
    setInspectItemId(itemId);
  };

  const refreshParty = async (preferredId = character.id) => {
    try {
      const result = await api.character(preferredId);
      setPartyView(result.character);
    } catch {
      const result = await api.character(character.id);
      setPartyView(result.character);
    }
  };

  const unlockPartySlot = async (_currency: 'gold' | 'coins') => {
    if (partyBusy || busy) return;
    setPartyBusy(true);
    try {
      onParty();
      window.setTimeout(() => void refreshParty(), 250);
    } finally {
      window.setTimeout(() => setPartyBusy(false), 300);
    }
  };

  const moveBackpackToLoot = async (itemId: number, count: number) => {
    if (lootActionBusy) return;
    setLootActionBusy(true);
    setLootActionError('');
    try {
      const result = await api.backpackToLoot(character.id, itemId, count);
      setView(result.character);
      setPartyView(result.character);
      setIgnoredItemIds(result.ignoredItemIds);
      setMenu(null);
    } catch (error) {
      setLootActionError(error instanceof Error ? error.message : 'Não foi possível mover o item para o Loot Pouch.');
    } finally {
      setLootActionBusy(false);
    }
  };

  const equipBackpackOnPartyMember = async (itemId: number, targetId: number) => {
    if (lootActionBusy) return;
    setLootActionBusy(true);
    setLootActionError('');
    try {
      await api.partyItemAct(character.id, targetId, { type: 'equip', itemId, source: 'backpack' });
      const owner = await api.character(character.id);
      setView(owner.character);
      setPartyView(owner.character);
      setMenu(null);
    } catch (error) {
      setLootActionError(error instanceof Error ? error.message : 'Não foi possível equipar o item neste personagem.');
    } finally {
      setLootActionBusy(false);
    }
  };

  const setItemIgnored = async (itemId: number, ignored: boolean) => {
    if (lootActionBusy) return;
    setLootActionBusy(true);
    setLootActionError('');
    try {
      const result = await api.setLootIgnored(character.id, itemId, ignored);
      setView(result.character);
      setPartyView(result.character);
      setIgnoredItemIds(result.ignoredItemIds);
      setMenu(null);
    } catch (error) {
      setLootActionError(error instanceof Error ? error.message : 'Não foi possível alterar o filtro de loot.');
    } finally {
      setLootActionBusy(false);
    }
  };

  const def = menu ? itemsById.get(menu.itemId) : null;
  const consumable = def ? isConsumableItem(def) : false;
  const equipable = def ? isEquipableItem(def) : false;
  const sellable = Boolean(def?.sellPrice);
  const unit = menu ? itemValue(menu.itemId) : 0;
  const menuIgnored = menu ? ignoredItemIds.includes(menu.itemId) : false;
  const compatiblePartyTargets = menu && def && menu.from === 'backpack' && equipable && !consumable
    ? partyEquipTargets.filter((target) => canEquipFor(def, target.vocationId, target.level))
    : [];
  const lootEnabledByStamina = view.stamina > 0;

  return <aside className="dock right">
    <PartyPanel
      character={partyView}
      busy={busy || partyBusy}
      onConfig={() => setPartyManagerOpen(true)}
      onItems={() => undefined}
      onOutfit={() => undefined}
      onToggle={() => undefined}
      onUnlock={(currency) => void unlockPartySlot(currency)}
      onBlessings={() => setBlessOpen(true)}
    />

    <DockBox id="backpack-panel" title="Backpack" extra={<span>{backpackItems.length} / {backpackCapacity}</span>}>
      {lootActionError && <div className="party-inline-error" role="alert">{lootActionError}</div>}
      <div className="grid8 supply-grid backpack-dock-grid">
        {backpackSlots.map((item, index) => <ItemSlot
          key={item.itemId ? `backpack-${item.itemId}` : `backpack-empty-${index}`}
          itemId={item.itemId || undefined}
          count={item.count}
          label={item.name}
          rarity={item.itemId ? itemRarity(item.itemId) : undefined}
          onInspect={item.itemId ? inspect : undefined}
          onClick={(event) => item.itemId && openMenu(event, { itemId: item.itemId, name: item.name, count: item.count, from: 'backpack' })}
        />)}
      </div>
      <div className="box-tools">
        <button className={`btn ${rare ? 'gold' : ''}`} onClick={() => setRare((on) => !on)}>Raridade</button>
        {ignoredItemIds.length > 0 && <span className="backpack-ignore-count">Não coletar: {ignoredItemIds.length}</span>}
      </div>
    </DockBox>

    <DockBox id="loot-pouch" title="Loot Pouch" extra={<span>Slots {lootItems.filter((s) => s.count > 0 && !ignoredItemIds.includes(s.itemId)).length} / {lootSlots}</span>}>
      {!lootEnabledByStamina && <div className="loot-status-warning">Loot desativado: sua stamina chegou a 0. Descanse para voltar a gerar loot.</div>}
      {lootEnabledByStamina && view.policy.lootMinValue > 0 && <div className="loot-status-note">Auto-venda ativa: itens abaixo de {view.policy.lootMinValue} gold viram gold e não aparecem no pouch.</div>}
      <div className="grid8 supply-grid">
        {lootPaged.visible.map((item, index) => <ItemSlot
          key={`loot-${lootPaged.safePage}-${index}-${item.itemId}`}
          itemId={item.itemId || undefined}
          count={item.count}
          label={item.name}
          onInspect={item.itemId ? inspect : undefined}
          onClick={(event) => item.itemId && openMenu(event, { itemId: item.itemId, name: item.name, count: item.count, from: 'pouch' })}
        />)}
      </div>
      <PouchPager page={lootPaged.safePage} pageCount={lootPaged.pageCount} onChange={setLootPage} />
      <div className="box-tools">
        <button className="btn gold" disabled={busy || !lootItems.length} onClick={onSell}>{t('sell')}</button>
        <button className="btn" disabled={busy || lootSlots >= LOOT_SLOT_CAP || view.gold < lootSlotCost} onClick={() => onLootSlot('gold')}>+slot {formatNumber(lootSlotCost)}g</button>
      </div>
      <div className="box-tools">
        <button className="btn gold" disabled={busy || lootSlots >= LOOT_SLOT_CAP || view.coins < lootSlotCoinCost} onClick={() => onLootSlot('coins')}>+slot {lootSlotCoinCost} TC</button>
      </div>
      <div className="pouch-filter-label">Auto-vender abaixo de (gold):</div>
      <div className="box-tools">
        {([0, 10, 50, 200, 1000] as const).map((value) => <button key={value} type="button" className={`btn ${view.policy.lootMinValue === value ? 'gold' : ''}`} disabled={busy} onClick={() => onLootFilter(value)}>{value === 0 ? t('lootFilterOff') : value}</button>)}
      </div>
    </DockBox>

    <DockBox id="supply-pouch" title="Supply Pouch" extra={<span>Slots {view.supplies.filter((s) => s.count > 0).length} / {supplySlots}</span>}>
      <div className="grid8 supply-grid">
        {supplyPaged.visible.map((item, index) => <ItemSlot
          key={`supply-${supplyPaged.safePage}-${index}-${item.itemId}`}
          itemId={item.itemId || undefined}
          count={item.count}
          label={item.name || itemsById.get(item.itemId)?.name}
          onInspect={item.itemId ? inspect : undefined}
          onClick={(event) => item.itemId && openMenu(event, { itemId: item.itemId, name: item.name, count: item.count, from: 'supply' })}
        />)}
      </div>
      <PouchPager page={supplyPaged.safePage} pageCount={supplyPaged.pageCount} onChange={setSupplyPage} />
      <div className="box-tools"><button className="btn" disabled={busy || supplySlots >= SUPPLY_SLOT_CAP || view.gold < supplySlotCost} onClick={() => onSupplySlot('gold')}>+slot {formatNumber(supplySlotCost)}g</button></div>
      <div className="box-tools"><button className="btn gold" disabled={busy || supplySlots >= SUPPLY_SLOT_CAP || view.coins < supplySlotCoinCost} onClick={() => onSupplySlot('coins')}>+slot {supplySlotCoinCost} TC</button></div>
    </DockBox>

    {menu && <div ref={menuRef} className="item-ctx" style={{ left: menu.x, top: menu.y }} role="menu">
      <div className="item-ctx-head">
        <strong>{menu.name}</strong>
        <span>×{menu.count}{unit ? ` · ${formatNumber(unit * menu.count)}g` : ''}</span>
        <div className="item-ctx-stats">{itemTooltipLines(menu.itemId).map((line) => <span key={line}>{line}</span>)}</div>
      </div>
      <button type="button" disabled={busy || lootActionBusy} onClick={() => inspect(menu.itemId)}>Inspecionar</button>
      {menu.from === 'backpack' && equipable && !consumable && <>
        <div className="item-ctx-section">Equipar em</div>
        {compatiblePartyTargets.map((target) => <button key={`equip-${target.id}`} type="button" disabled={busy || lootActionBusy} onClick={() => void equipBackpackOnPartyMember(menu.itemId, target.id)}>Equipar em {target.name}</button>)}
        {compatiblePartyTargets.length === 0 && <button type="button" disabled>Nenhum membro compatível</button>}
      </>}
      {consumable && <button type="button" disabled={busy || lootActionBusy} onClick={() => run(() => onUseItem(menu.itemId, menu.from))}>Usar</button>}
      {menu.from === 'backpack' && <button type="button" disabled={busy || lootActionBusy || view.session?.status !== 'active' || menuIgnored} title={view.session?.status !== 'active' ? 'Entre em uma hunt para usar o Loot Pouch' : menuIgnored ? 'Volte a coletar este item antes de enviá-lo ao pouch' : undefined} onClick={() => void moveBackpackToLoot(menu.itemId, menu.count)}>Enviar para Loot Pouch</button>}
      {menu.from === 'backpack' && <button type="button" className={menuIgnored ? '' : 'danger'} disabled={busy || lootActionBusy} onClick={() => void setItemIgnored(menu.itemId, !menuIgnored)}>{menuIgnored ? 'Voltar a coletar este item' : 'Não coletar este item'}</button>}
      {menu.from === 'pouch' && <button type="button" className="danger" disabled={busy || lootActionBusy} onClick={() => void setItemIgnored(menu.itemId, true)}>Não coletar mais este item</button>}
      {menu.from !== 'backpack' && <button type="button" disabled={busy || lootActionBusy} onClick={() => run(() => onMoveItem(menu.itemId, menu.from, menu.count))}>Mover pra backpack</button>}
      {menu.from === 'backpack' && <>
        <button type="button" disabled={busy || lootActionBusy} onClick={() => run(() => onBackpackWithdraw(menu.itemId, menu.count, 'supply'))}>Mover pra supply</button>
        <button type="button" disabled={busy || lootActionBusy} onClick={() => run(() => onBackpackWithdraw(menu.itemId, menu.count, 'warehouse'))}>Mover pro armazém</button>
      </>}
      {sellable && <button type="button" disabled={busy || lootActionBusy} onClick={() => run(() => onSellItem(menu.itemId, menu.from, menu.count))}>Vender ({formatNumber(unit * menu.count)}g)</button>}
      <button type="button" className="danger" disabled={busy || lootActionBusy} onClick={() => run(() => onDestroyItem(menu.itemId, menu.from, menu.count))}>Destruir</button>
    </div>}

    {inspectItemId != null && <ItemInspectModal itemId={inspectItemId} onClose={() => setInspectItemId(null)} />}

    {blessOpen && <BlessingModal character={view} busy={busy} onClose={() => setBlessOpen(false)} onBuy={(index) => void onBlessing({ blessIndex: index })} onBuyAll={() => void onBlessing({ buyAll: true }).then(() => setBlessOpen(false))} />}

    {partyManagerOpen && <PartyManagerModal character={partyView} onClose={() => setPartyManagerOpen(false)} onSaved={(next) => { setPartyView(next); setView(next); void refreshParty(next.id); }} />}
  </aside>;
}
