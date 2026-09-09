import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { itemsById, vocationsById } from '@tibia-idle/data';
import { allMainBlessings, blessingCount, canEquipFor, isConsumableItem, isEquipableItem, LOOT_SLOT_CAP, LOOT_SLOT_DEFAULT, POUCH_SLOTS_PER_PAGE, SUPPLY_SLOT_CAP } from '@tibia-idle/sim';
import type { CharacterView, EquippedItem } from '../api/types.js';
import { itemRarity, itemValue, formatNumber, xpProgress } from '../format.js';
import { itemTooltipLines } from '../itemFormat.js';
import { useLocale } from '../i18n/Locale.js';
import { BlessingModal } from './BlessingModal.js';
import { BackpackModal } from './BackpackModal.js';
import { DockBox } from './DockBox.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';
import { blessingSetButtonIcon } from '../render/blessingIcon.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';

type ItemSource = 'worn' | 'pouch' | 'supply' | 'backpack';
type SlotCurrency = 'gold' | 'coins';

type MenuState = {
  itemId: number;
  name: string;
  count: number;
  from: ItemSource;
  slot?: string;
  x: number;
  y: number;
};

type StackView = { itemId: number; name: string; count: number };

function pad<T>(items: T[], size: number, empty: T): T[] {
  const next = items.slice(0, size);
  while (next.length < size) next.push(empty);
  return next;
}

function byValue<T extends { itemId: number }>(items: T[], rare: boolean): T[] {
  if (!rare) return items;
  return [...items].sort((a, b) => itemValue(b.itemId) - itemValue(a.itemId));
}

function paginateSlots<T>(
  items: T[],
  totalSlots: number,
  page: number,
  empty: T,
): { visible: T[]; pageCount: number; safePage: number } {
  const pageCount = Math.max(1, Math.ceil(totalSlots / POUCH_SLOTS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * POUCH_SLOTS_PER_PAGE;
  const onPage = Math.min(POUCH_SLOTS_PER_PAGE, totalSlots - start);
  return {
    visible: pad(items.slice(start, start + onPage), onPage, empty),
    pageCount,
    safePage,
  };
}

function PouchPager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="pouch-pager">
      <button type="button" className="btn" disabled={page <= 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">‹</button>
      <span>{page + 1} / {pageCount}</span>
      <button type="button" className="btn" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)} aria-label="Próxima página">›</button>
    </div>
  );
}

export function RightDock({
  character,
  busy,
  onSell,
  onUpgrade,
  onParty,
  onRemoveParty,
  onOutfit,
  onLootSlot,
  onSupplySlot,
  onLootFilter,
  onEquip,
  onUnequip,
  onDestroyItem,
  onSellItem,
  onMoveItem,
  onUseItem,
  onBackpackWithdraw,
  onBlessing,
}: {
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
  onDestroyItem: (itemId: number, source: ItemSource, count: number, slot?: string) => void;
  onSellItem: (itemId: number, source: Exclude<ItemSource, 'worn'>, count: number) => void;
  onMoveItem: (itemId: number, source: 'pouch' | 'supply', count: number) => void;
  onUseItem: (itemId: number, source: 'pouch' | 'supply' | 'backpack') => void;
  onBackpackWithdraw: (itemId: number, count: number, target: 'supply' | 'warehouse') => void;
  onBlessing: (body: { blessIndex?: number; buyAll?: boolean }) => Promise<void>;
}) {
  const { t } = useLocale();
  const [rare, setRare] = useState(false);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [partyInventoryId, setPartyInventoryId] = useState<number | null>(null);
  const [setMemberId, setSetMemberId] = useState(character.id);
  const [blessOpen, setBlessOpen] = useState(false);
  const [lootPage, setLootPage] = useState(0);
  const [supplyPage, setSupplyPage] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [inspectItemId, setInspectItemId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const xp = xpProgress(character.level, character.experience);
  const lootSlots = character.lootSlots ?? LOOT_SLOT_DEFAULT;
  const supplySlots = character.supplySlots ?? 20;
  const lootSlotCost = character.lootSlotCost ?? 10_000;
  const lootSlotCoinCost = character.lootSlotCoinCost ?? 10;
  const supplySlotCost = character.supplySlotCost ?? 10_000;
  const supplySlotCoinCost = character.supplySlotCoinCost ?? 10;
  const empty: StackView = { itemId: 0, name: '', count: 0 };
  const lootAll = pad(byValue(character.session?.loot ?? [], rare), lootSlots, empty);
  const supplyAll = pad(byValue(character.supplies.filter((stack) => stack.count > 0), rare), supplySlots, empty);
  const lootPaged = paginateSlots(lootAll, lootSlots, lootPage, empty);
  const supplyPaged = paginateSlots(supplyAll, supplySlots, supplyPage, empty);
  const activeParty = (character.caveParty ?? []).filter((mate) => mate.self || mate.active);
  const selectedSetMember = activeParty.find((mate) => mate.id === setMemberId);
  const viewingOwnSet = !selectedSetMember || selectedSetMember.id === character.id;
  const setEquipment = viewingOwnSet ? character.equipment : selectedSetMember.equipment ?? {};
  const setWorn = Object.keys(setEquipment).length;
  const blessMask = character.blessings ?? 0;
  const blessOwned = blessingCount(blessMask);
  const blessFull = allMainBlessings(blessMask);
  const blessBtnIcon = useMemo(
    () => blessingSetButtonIcon(blessFull ? 'gold' : 'grey', 20),
    [blessFull],
  );

  useEffect(() => {
    if (lootPage !== lootPaged.safePage) setLootPage(lootPaged.safePage);
  }, [lootPage, lootPaged.safePage]);

  useEffect(() => {
    if (supplyPage !== supplyPaged.safePage) setSupplyPage(supplyPaged.safePage);
  }, [supplyPage, supplyPaged.safePage]);

  useEffect(() => {
    if (!activeParty.some((mate) => mate.id === setMemberId)) setSetMemberId(character.id);
  }, [activeParty, character.id, setMemberId]);

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

  const openMenu = (
    event: ReactMouseEvent,
    next: Omit<MenuState, 'x' | 'y'>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 180);
    const y = Math.min(event.clientY, window.innerHeight - 220);
    setMenu({ ...next, x: Math.max(8, x), y: Math.max(8, y) });
  };

  const run = (action: () => void) => {
    setMenu(null);
    action();
  };

  const inspect = (itemId: number) => {
    setMenu(null);
    setInspectItemId(itemId);
  };

  const def = menu ? itemsById.get(menu.itemId) : null;
  const consumable = def ? isConsumableItem(def) : false;
  const equipable = def ? isEquipableItem(def) : false;
  const compatible = def ? canEquipFor(def, character.vocation.id, character.level) : false;
  const sellable = Boolean(def?.sellPrice);
  const unit = menu ? itemValue(menu.itemId) : 0;

  return (
    <aside className="dock right">
      <DockBox id="party-config" title="Party Config">
          <div className="party-members">
            {(character.caveParty?.length
              ? character.caveParty
              : [{ id: character.id, name: character.name, level: character.level, vocationId: character.vocation.id, self: true, appearance: character.appearance }]
            ).map((mate) => {
              const mateXp = mate.self ? xp : xpProgress(mate.level, mate.experience ?? 0);
              const health = mate.self ? character.health : mate.health ?? 0;
              const memberMaxHealth = mate.self ? character.maxHealth : mate.maxHealth;
              const maxHealth = memberMaxHealth ?? Math.max(1, health);
              const mana = mate.self ? character.mana : mate.mana ?? 0;
              const memberMaxMana = mate.self ? character.maxMana : mate.maxMana;
              const maxMana = memberMaxMana ?? Math.max(1, mana);
              const backpack = mate.backpackContents ?? [];
              return (
                <div key={`${mate.id}-${mate.name}`} className={`party-member-wrap ${mate.self ? 'self' : ''}`}>
                  <div className="party-member">
                    <div className="party-member-info">
                      <div className="party-name">{mate.self ? character.name : mate.name}</div>
                      <div className="party-sub">
                        {mate.self
                          ? `${character.vocation.name} - lvl ${character.level}`
                          : `${vocationsById.get(mate.vocationId)?.name ?? 'Classe desconhecida'} - lvl ${mate.level}`}
                      </div>
                    </div>
                    {mate.self ? (
                      <button type="button" className="btn gold party-outfit-btn" disabled={busy} onClick={onOutfit}>
                        Outfit
                      </button>
                    ) : (
                      <div className="party-member-actions">
                        <button type="button" className="btn" onClick={() => setPartyInventoryId(partyInventoryId === mate.id ? null : mate.id)} title="Ver inventário" aria-label={`Ver inventário de ${mate.name}`}>
                          Bag
                        </button>
                        <button
                          type="button"
                          className="btn danger party-remove-btn"
                          disabled={busy}
                          onClick={() => onRemoveParty(mate.id)}
                          title="Remover da party"
                          aria-label={`Remover ${mate.name} da party`}
                        >
                          −
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="party-member-stats">
                    <div className="party-stat-line"><span>HP</span><div className="meter hp"><i style={{ width: `${(health / maxHealth) * 100}%` }} /></div><b>{health}</b></div>
                    <div className="party-stat-line"><span>MP</span><div className="meter mana"><i style={{ width: `${(mana / maxMana) * 100}%` }} /></div><b>{mana}</b></div>
                    <div className="party-stat-line"><span>XP</span><div className="meter xp"><i style={{ width: `${mateXp.percent}%` }} /></div><b>{Math.round(mateXp.percent)}%</b></div>
                  </div>
                  {partyInventoryId === mate.id && (
                    <div className="party-member-inventory">
                      <span>Inventário · {backpack.length}/{mate.backpackCapacity ?? backpack.length}</span>
                      <div className="party-inventory-slots">
                        {backpack.map((item) => <ItemSlot key={`${mate.id}-${item.itemId}`} itemId={item.itemId} count={item.count} label={item.name} compact />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {character.partySlots < 2 && (
            <div className="locked-slot">
              SLOT BLOQUEADO
              <button className="btn" disabled={busy} onClick={onParty}>desbloquear 10.000 gold</button>
            </div>
          )}
          {character.partySlots < 3 && (
            <div className="locked-slot">
              SLOT BLOQUEADO
              <button className="btn" disabled={busy || character.partySlots < 2} onClick={onParty}>desbloquear 75 coins</button>
            </div>
          )}
          {character.partySlots > 1 && (
            <div className="party-sub">
              Party {character.partySlots}/3 · compartilha XP com até {character.partySlots - 1} caçador{character.partySlots > 2 ? 'es' : ''} na cave
              {character.partyBonus > 0 ? ` · +${character.partyBonus}% agora` : ''}
            </div>
          )}
      </DockBox>

      <DockBox id="set" title={t('setTitle')} extra={<span>{setWorn} / 10</span>}>
          {activeParty.length > 1 && (
            <div className="party-set-tabs" role="tablist" aria-label="SET dos personagens ativos">
              {activeParty.map((mate) => (
                <button
                  key={mate.id}
                  type="button"
                  className={`btn ${setMemberId === mate.id ? 'gold' : ''}`}
                  onClick={() => setSetMemberId(mate.id)}
                  role="tab"
                  aria-selected={setMemberId === mate.id}
                >
                  {mate.self ? character.name : mate.name}
                </button>
              ))}
            </div>
          )}
          <div className={`paperdoll ${blessFull ? 'blessed' : ''}`}>
            {viewingOwnSet && <div className="paper-bless-wrap">
              <button
                type="button"
                className={`bless-set-btn ${blessFull ? 'gold' : blessOwned > 0 ? 'partial' : ''}`}
                title={`${t('blessHint')} (${blessOwned}/5)`}
                onClick={() => setBlessOpen(true)}
              >
                <img src={blessBtnIcon} alt="" width={20} height={20} draggable={false} />
                <span className="bless-set-count">{blessOwned}/5</span>
              </button>
            </div>}
            {PAPERDOLL_SLOTS.map((slot) => {
              const item = setEquipment[slot.id] as EquippedItem | undefined;
              return (
                <div key={slot.id} className={`paper-slot ${slot.area}`}>
                  <ItemSlot
                    itemId={item?.id}
                    label={item?.name}
                    emptyLabel={!item && slot.empty ? t(slot.empty) : undefined}
                    rarity={item ? itemRarity(item.id) : undefined}
                    onInspect={item ? inspect : undefined}
                    onClick={(event) => {
                      if (slot.id === 'backpack' && item && viewingOwnSet) {
                        setBackpackOpen(true);
                        return;
                      }
                      if (item) {
                        openMenu(event, {
                          itemId: item.id,
                          name: item.name,
                          count: 1,
                          from: 'worn',
                          slot: slot.id,
                        });
                      }
                    }}
                    onContextMenu={(event) => {
                      if (slot.id === 'backpack' && item && viewingOwnSet) {
                        event.preventDefault();
                        openMenu(event, {
                          itemId: item.id,
                          name: item.name,
                          count: 1,
                          from: 'worn',
                          slot: slot.id,
                        });
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
          {viewingOwnSet && <div className="box-tools">
            <button className="btn" disabled={busy || Boolean(character.session)} onClick={onUpgrade}>{t('organize')}</button>
            <button className={`btn ${rare ? 'gold' : ''}`} onClick={() => setRare((on) => !on)}>Raridade</button>
          </div>}
          <div className="party-set-backpack">
            <div className="party-set-backpack-title">
              Backpack de {viewingOwnSet ? character.name : selectedSetMember?.name} · {(viewingOwnSet ? character.backpackContents : selectedSetMember?.backpackContents ?? []).length}/{viewingOwnSet ? character.backpackCapacity : selectedSetMember?.backpackCapacity ?? 0}
            </div>
            <div className="party-inventory-slots">
              {(viewingOwnSet ? character.backpackContents : selectedSetMember?.backpackContents ?? []).map((item) => (
                <ItemSlot key={`set-${viewingOwnSet ? character.id : selectedSetMember?.id}-${item.itemId}`} itemId={item.itemId} count={item.count} label={item.name} compact />
              ))}
              {(viewingOwnSet ? character.backpackContents : selectedSetMember?.backpackContents ?? []).length === 0 && <span className="party-empty-backpack">Backpack vazia</span>}
            </div>
          </div>
      </DockBox>

      <DockBox
        id="loot-pouch"
        title="Loot Pouch"
        extra={<span>Slots {character.session?.loot.filter((s) => s.count > 0).length ?? 0} / {lootSlots}</span>}
      >
          <div className="grid8 supply-grid">
            {lootPaged.visible.map((item, index) => (
              <ItemSlot
                key={`loot-${lootPaged.safePage}-${index}-${item.itemId}`}
                itemId={item.itemId || undefined}
                count={item.count}
                label={item.name}
                onInspect={item.itemId ? inspect : undefined}
                onClick={(event) => item.itemId && openMenu(event, {
                  itemId: item.itemId,
                  name: item.name,
                  count: item.count,
                  from: 'pouch',
                })}
              />
            ))}
          </div>
          <PouchPager page={lootPaged.safePage} pageCount={lootPaged.pageCount} onChange={setLootPage} />
          <div className="box-tools">
            <button className="btn gold" disabled={busy || !(character.session?.loot.length)} onClick={onSell}>{t('sell')}</button>
            <button className="btn" disabled={busy || lootSlots >= LOOT_SLOT_CAP || character.gold < lootSlotCost} onClick={() => onLootSlot('gold')}>
              +slot {formatNumber(lootSlotCost)}g
            </button>
          </div>
          <div className="box-tools">
            <button
              className="btn gold"
              disabled={busy || lootSlots >= LOOT_SLOT_CAP || character.coins < lootSlotCoinCost}
              onClick={() => onLootSlot('coins')}
            >
              +slot {lootSlotCoinCost} TC
            </button>
          </div>
          <div className="pouch-filter-label">Auto-vender abaixo de (gold):</div>
          <div className="box-tools">
            {([0, 10, 50, 200, 1000] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`btn ${character.policy.lootMinValue === value ? 'gold' : ''}`}
                disabled={busy}
                onClick={() => onLootFilter(value)}
              >
                {value === 0 ? t('lootFilterOff') : `${value}`}
              </button>
            ))}
          </div>
      </DockBox>

      <DockBox id="supply-pouch" title="Supply Pouch" extra={<span>Slots {character.supplies.filter((s) => s.count > 0).length} / {supplySlots}</span>}>
          <div className="grid8 supply-grid">
            {supplyPaged.visible.map((item, index) => (
              <ItemSlot
                key={`supply-${supplyPaged.safePage}-${index}-${item.itemId}`}
                itemId={item.itemId || undefined}
                count={item.count}
                label={item.name || itemsById.get(item.itemId)?.name}
                onInspect={item.itemId ? inspect : undefined}
                onClick={(event) => item.itemId && openMenu(event, {
                  itemId: item.itemId,
                  name: item.name,
                  count: item.count,
                  from: 'supply',
                })}
              />
            ))}
          </div>
          <PouchPager page={supplyPaged.safePage} pageCount={supplyPaged.pageCount} onChange={setSupplyPage} />
          <div className="box-tools">
            <button className="btn" disabled={busy || supplySlots >= SUPPLY_SLOT_CAP || character.gold < supplySlotCost} onClick={() => onSupplySlot('gold')}>
              +slot {formatNumber(supplySlotCost)}g
            </button>
          </div>
          <div className="box-tools">
            <button
              className="btn gold"
              disabled={busy || supplySlots >= SUPPLY_SLOT_CAP || character.coins < supplySlotCoinCost}
              onClick={() => onSupplySlot('coins')}
            >
              +slot {supplySlotCoinCost} TC
            </button>
          </div>
      </DockBox>

      {menu && (
        <div
          ref={menuRef}
          className="item-ctx"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
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
          <button type="button" disabled={busy} onClick={() => inspect(menu.itemId)}>Inspecionar</button>
          {menu.from === 'worn' && menu.slot && menu.slot !== 'backpack' && (
            <button type="button" disabled={busy} onClick={() => run(() => onUnequip(menu.slot!, setMemberId))}>Desequipar</button>
          )}
          {menu.from === 'worn' && menu.slot === 'backpack' && (
            <button type="button" disabled={busy} onClick={() => run(() => setBackpackOpen(true))}>Abrir</button>
          )}
          {menu.from === 'worn' && menu.slot === 'backpack' && (character.backpackContents?.length ?? 0) === 0 && (
            <button type="button" disabled={busy} onClick={() => run(() => onUnequip('backpack'))}>Desequipar</button>
          )}
          {menu.from === 'pouch' && equipable && !consumable && (
            <button type="button" disabled={busy || !compatible} title={!compatible ? 'Item incompatível com sua classe ou nível' : undefined} onClick={() => run(() => onEquip(menu.itemId, 'pouch'))}>Equipar</button>
          )}
          {menu.from === 'supply' && equipable && !consumable && (
            <button type="button" disabled={busy || !compatible} title={!compatible ? 'Item incompatível com sua classe ou nível' : undefined} onClick={() => run(() => onEquip(menu.itemId, 'supply'))}>Equipar</button>
          )}
          {consumable && menu.from !== 'worn' && (
            <button type="button" disabled={busy} onClick={() => run(() => onUseItem(menu.itemId, menu.from === 'pouch' ? 'pouch' : 'supply'))}>Usar</button>
          )}
          {menu.from !== 'worn' && (
            <button type="button" disabled={busy} onClick={() => run(() => onMoveItem(menu.itemId, menu.from === 'pouch' ? 'pouch' : 'supply', menu.count))}>
              Mover pra backpack
            </button>
          )}
          {sellable && (menu.from === 'pouch' || menu.from === 'supply') && (
            <button type="button" disabled={busy} onClick={() => {
              const source = menu.from === 'supply' ? 'supply' as const : 'pouch' as const;
              run(() => onSellItem(menu.itemId, source, menu.count));
            }}>
              Vender ({formatNumber(unit * menu.count)}g)
            </button>
          )}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => run(() => onDestroyItem(menu.itemId, menu.from, menu.count, menu.slot))}
          >
            Destruir
          </button>
        </div>
      )}

      {inspectItemId != null && (
        <ItemInspectModal itemId={inspectItemId} onClose={() => setInspectItemId(null)} />
      )}

      {backpackOpen && character.equipment.backpack && (
        <BackpackModal
          character={character}
          busy={busy}
          onClose={() => setBackpackOpen(false)}
          onInspect={inspect}
          onEquip={(itemId) => onEquip(itemId, 'backpack')}
          onUnequip={() => {
            setBackpackOpen(false);
            onUnequip('backpack');
          }}
          onWithdraw={(itemId, count, target) => onBackpackWithdraw(itemId, count, target)}
          onSellItem={(itemId, count) => onSellItem(itemId, 'backpack', count)}
          onDestroyItem={(itemId, count) => onDestroyItem(itemId, 'backpack', count)}
          onUseItem={(itemId) => onUseItem(itemId, 'backpack')}
        />
      )}

      {blessOpen && (
        <BlessingModal
          character={character}
          busy={busy}
          onClose={() => setBlessOpen(false)}
          onBuy={(index) => void onBlessing({ blessIndex: index })}
          onBuyAll={() => void onBlessing({ buyAll: true }).then(() => setBlessOpen(false))}
        />
      )}
    </aside>
  );
}
