import { useEffect, useMemo, useState } from 'react';
import { charms, hunts, items, itemsById, monsters, monstersById, type Item, type Monster } from '@tibia-idle/data';
import { BLESSING_CAP, bestiaryStage, blessingCount, ITEM_MARKET_CATEGORIES, PROMOTION_GOLD, PROMOTION_LEVEL, isPromoted, slotFor, DEPOT_SLOT_CAP } from '@tibia-idle/sim';
import { api } from '../api/client.js';
import type { CharacterView, WorldView } from '../api/types.js';
import type { OverlayId } from './TopNav.js';
import { ItemDetailPanel } from './ItemDetailPanel.js';
import { ItemSlot } from './ItemSlot.js';
import { StorePanel } from './StorePanel.js';
import { RoulettePanel } from './RoulettePanel.js';
import { BuildPanel } from './BuildPanel.js';
import { ProgressaoPanel } from './ProgressaoPanel.js';
import { WindowHead } from './WindowHead.js';
import { formatNumber, formatRate } from '../format.js';
import { itemMarketCategory } from '../itemFormat.js';

export function SystemsPanel({
  overlay,
  character,
  busy,
  onClose,
  onAct,
}: {
  overlay: OverlayId;
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const [world, setWorld] = useState<WorldView | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('Items');
  const [progressaoTitle, setProgressaoTitle] = useState('Progressão');

  useEffect(() => {
    if (overlay !== 'progressao') setProgressaoTitle('Progressão');
  }, [overlay]);

  useEffect(() => {
    const scope = overlay === 'market' ? 'market' : 'geral';
    void api.world(scope)
      .then(setWorld)
      .catch(() => undefined);
  }, [overlay, character.id, character.gold, character.coins]);

  const title = ({
    cyclopedia: 'Cyclopedia',
    market: 'Mercado',
    loja: 'Loja',
    vip: 'VIP',
    rank: 'Rank',
    build: 'Build',
    progressao: progressaoTitle,
    roleta: 'Roleta',
    depot: 'Depot',
  } as Partial<Record<OverlayId, string>>)[overlay] ?? overlay;

  return (
    <div className="modal" onClick={onClose}>
      <div className={`modal-card wide${
        overlay === 'depot' ? ' depot-modal'
          : overlay === 'progressao' ? ' progressao-modal'
              : overlay === 'build' ? ' build-modal'
                  : overlay === 'market' || overlay === 'cyclopedia' ? ' compact-modal' : ''
      }`} onClick={(event) => event.stopPropagation()}>
        <WindowHead title={title} onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">
        {overlay === 'cyclopedia' && <Cyclopedia character={character} query={query} setQuery={setQuery} tab={tab} setTab={setTab} busy={busy} onAct={onAct} />}
        {overlay === 'build' && <BuildPanel character={character} />}
        {overlay === 'roleta' && <RoulettePanel character={character} busy={busy} onAct={onAct} />}
        {overlay === 'progressao' && (
          <ProgressaoPanel
            character={character}
            world={world}
            busy={busy}
            onAct={onAct}
            onTitle={setProgressaoTitle}
          />
        )}
        {overlay === 'depot' && <Warehouse character={character} busy={busy} onAct={onAct} />}
        {overlay === 'loja' && <StorePanel character={character} world={world} busy={busy} onAct={onAct} />}
        {overlay === 'market' && <GoldMercado character={character} world={world} busy={busy} onAct={onAct} />}
        {overlay === 'vip' && <Vip character={character} busy={busy} onAct={onAct} />}
        {overlay === 'rank' && <Rank world={world} />}
        </div>
      </div>
    </div>
  );
}

function BestiaryDetail({ monster, kills }: { monster: Monster; kills: number }) {
  const bestiary = monster.bestiary;
  const stage = bestiaryStage(kills, bestiary?.firstUnlock ?? 0, bestiary?.secondUnlock ?? 0, bestiary?.toKill ?? 0);
  const showStats = stage !== 'unknown';
  const showLoot = stage === 'adept' || stage === 'mastered';
  const elements = Object.entries(monster.elements).map(([type, value]) => `${type.replace('COMBAT_', '').replace('DAMAGE', '')} ${value}%`);
  return (
    <div className="compact-detail">
      <h3>{showStats ? monster.name : '???'}</h3>
      <p className="lede" style={{ textAlign: 'left' }}>{BESTIARY_STAGE_PT[stage]}</p>
      <div className="kv">
        <span>Kills</span><strong>{kills}/{bestiary?.toKill ?? 0}</strong>
        <span>Charm</span><strong>{bestiary?.charmPoints ?? 0} pts</strong>
        {showStats ? <><span>HP</span><strong>{formatNumber(monster.health)}</strong></> : null}
        {showStats ? <><span>XP</span><strong>{formatNumber(monster.experience)}</strong></> : null}
        {showStats ? <><span>Armadura</span><strong>{monster.armor}</strong></> : null}
        {showStats && elements.length > 0 ? <><span>Elementos</span><strong>{elements.slice(0, 4).join(', ')}</strong></> : null}
      </div>
      {showLoot && (
        <>
          <p className="compact-hint">Loot</p>
          <div className="compact-list" style={{ maxHeight: 180 }}>
            {monster.loot.slice(0, 12).map((drop) => (
              <div className="compact-row" key={drop.itemId}>
                <div className="compact-row-main">
                  <ItemSlot itemId={drop.itemId} count={drop.maxCount} label={drop.itemName} compact />
                  <span className="compact-row-name">{drop.itemName}</span>
                  <span className="compact-row-meta">até {drop.maxCount}</span>
                </div>
                <span className="compact-row-price">{(drop.chance / 1000).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      {!showLoot && showStats && (
        <p className="compact-hint">Loot no estágio Adepto ({bestiary?.secondUnlock ?? 0} kills).</p>
      )}
    </div>
  );
}

const BESTIARY_STAGE_PT: Record<string, string> = {
  unknown: 'Desconhecida',
  observed: 'Observada',
  proficient: 'Proficiente · +2% dano',
  adept: 'Adepto · +2% loot',
  mastered: 'Mestra · +3% XP',
};

function Cyclopedia({
  character, query, setQuery, tab, setTab, busy, onAct,
}: {
  character: CharacterView;
  query: string;
  setQuery: (value: string) => void;
  tab: string;
  setTab: (value: string) => void;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const needle = query.trim().toLowerCase();
  const [itemId, setItemId] = useState<number | null>(null);
  const [beastId, setBeastId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [itemPage, setItemPage] = useState(0);
  const PAGE = 120;

  const filteredItems = useMemo(() => {
    const rows = items.filter((item) => {
      if (categoryId !== 'all' && itemMarketCategory(item) !== categoryId) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle)
        || (item.type ?? '').toLowerCase().includes(needle)
        || String(item.id) === needle;
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [needle, categoryId]);

  const itemRows = filteredItems.slice(itemPage * PAGE, itemPage * PAGE + PAGE);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE));

  const beasts = useMemo(() => monsters.filter((monster) => monster.bestiary && (!needle || monster.name.toLowerCase().includes(needle))).slice(0, 80), [needle]);
  const bosses = useMemo(() => monsters.filter((monster) => monster.bosstiaryRace && (!needle || monster.name.toLowerCase().includes(needle))).slice(0, 60), [needle]);
  const selectedItem = itemId ? itemsById.get(itemId) : null;
  const selectedBeast = beastId ? monstersById.get(beastId) : null;

  useEffect(() => {
    setItemPage(0);
  }, [needle, categoryId]);

  return (
    <div className="compact-panel">
      <div className="compact-toolbar">
        <div className="tabs">
          {['Items', 'Bestiary', 'Bosstiary', 'Character'].map((name) => (
            <button key={name} type="button" className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>{name}</button>
          ))}
        </div>
        {tab !== 'Character' && (
          <input
            className="compact-search"
            placeholder="Buscar…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </div>
      {tab === 'Items' && (
        <>
          <div className="cy-cats compact-tabs">
            <button type="button" className={categoryId === 'all' ? 'on' : ''} onClick={() => setCategoryId('all')}>
              Todos ({items.length})
            </button>
            {ITEM_MARKET_CATEGORIES.map((cat) => (
              <button key={cat.id} type="button" className={categoryId === cat.id ? 'on' : ''} onClick={() => setCategoryId(cat.id)}>
                {cat.name}
              </button>
            ))}
          </div>
          <p className="compact-hint">
            {filteredItems.length.toLocaleString('pt-BR')} itens
            {pageCount > 1 ? ` · pág. ${itemPage + 1}/${pageCount}` : ''}
          </p>
          <div className="compact-split">
            <div className="compact-list">
              {itemRows.map((item) => (
                <button
                  type="button"
                  className={`compact-row ${itemId === item.id ? 'on' : ''}`}
                  key={item.id}
                  onClick={() => setItemId(item.id)}
                >
                  <div className="compact-row-main">
                    <ItemSlot itemId={item.id} label={item.name} compact />
                    <span className="compact-row-name" title={item.name}>{item.name}</span>
                    <span className="compact-row-meta">
                      {item.weaponType || item.slot || item.type || 'item'}
                      {' · '}
                      {(item.weight / 100).toFixed(1)} oz
                      {item.attack > 0 ? ` · Atk ${item.attack}` : ''}
                      {item.armor > 0 ? ` · Arm ${item.armor}` : ''}
                    </span>
                  </div>
                  <span className="compact-row-price">{item.sellPrice ? `${formatNumber(item.sellPrice)}g` : '—'}</span>
                </button>
              ))}
              {pageCount > 1 && (
                <div className="compact-pager">
                  <button className="btn" type="button" disabled={itemPage <= 0} onClick={() => setItemPage((p) => p - 1)}>Anterior</button>
                  <button className="btn" type="button" disabled={itemPage + 1 >= pageCount} onClick={() => setItemPage((p) => p + 1)}>Próxima</button>
                </div>
              )}
            </div>
            {selectedItem && <ItemDetailPanel item={selectedItem} />}
          </div>
        </>
      )}
      {tab === 'Bestiary' && (
        <div className="compact-split">
          <div className="compact-list">
            {beasts.map((monster) => {
              const kills = character.bestiary[monster.id] ?? 0;
              const goal = monster.bestiary?.toKill ?? 0;
              const stage = bestiaryStage(kills, monster.bestiary?.firstUnlock ?? 0, monster.bestiary?.secondUnlock ?? 0, goal);
              return (
                <button
                  type="button"
                  className={`compact-row ${beastId === monster.id ? 'on' : ''}`}
                  key={monster.id}
                  onClick={() => setBeastId(monster.id)}
                >
                  <div className="compact-row-main">
                    <span className="compact-row-name">{stage === 'unknown' ? '???' : monster.name}</span>
                    <span className="compact-row-meta">
                      {kills}/{goal} · {monster.bestiary?.stars}★ · {BESTIARY_STAGE_PT[stage]}
                    </span>
                  </div>
                  <span className="compact-row-price">{stage === 'unknown' ? '—' : `${formatNumber(monster.experience)} XP`}</span>
                </button>
              );
            })}
          </div>
          {selectedBeast && <BestiaryDetail monster={selectedBeast} kills={character.bestiary[selectedBeast.id] ?? 0} />}
        </div>
      )}
      {tab === 'Bosstiary' && (
        <>
          <p className="compact-hint">
            {character.bossPoints} pts · loot +{character.bossLootBonus}%
            · slots {character.bossSlots.length}/{character.bossSlotCap}
          </p>
          <div className="compact-list">
            {bosses.map((monster) => {
              const kills = character.bosstiary?.[monster.id] ?? 0;
              const slotted = character.bossSlots.includes(monster.id);
              const race = monster.bosstiaryRace ?? '—';
              return (
                <div className="compact-row" key={monster.id}>
                  <div className="compact-row-main">
                    <span className="compact-row-name">{monster.name}</span>
                    <span className="compact-row-meta">{kills} kills · {race} · {monster.category}</span>
                  </div>
                  <button className={`btn compact-buy ${slotted ? 'gold' : ''}`} disabled={busy} onClick={() => void onAct({ type: 'boss-slot', monsterId: monster.id })}>
                    {slotted ? 'slot' : 'usar'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'Character' && (
        <>
          <div className="compact-detail" style={{ position: 'static', maxHeight: 'none' }}>
            <div className="kv">
              <span>Nome</span><strong>{character.name}</strong>
              <span>Vocação</span><strong>{character.vocation.name}</strong>
              <span>Level</span><strong>{character.level}</strong>
              <span>Magic Level</span><strong>{character.magicLevel}</strong>
              <span>{character.stats.attackSkillName}</span><strong>{character.stats.attackSkill}</strong>
              <span>Defesa</span><strong>{character.stats.defense}</strong>
              <span>Armadura</span><strong>{character.stats.armor}</strong>
              <span>Capacidade</span><strong>{formatNumber(character.stats.capacity ?? 0)}</strong>
              <span>DPS</span><strong>{formatNumber(character.stats.damagePerSecond)}</strong>
              <span>Stamina</span><strong>{character.stamina} min</strong>
              <span>Gold</span><strong>{formatNumber(character.gold)}</strong>
              <span>Bênçãos</span><strong>{blessingCount(character.blessings ?? 0)}/{BLESSING_CAP}</strong>
              <span>Soul</span><strong>{character.soul ?? 0}/{character.soulMax ?? 100}</strong>
              <span>Promoção</span><strong>{character.promoted || isPromoted(character.vocation.id) ? 'sim' : `lvl ${PROMOTION_LEVEL}`}</strong>
              <span>Coins</span><strong>{character.coins}</strong>
              <span>Charm points</span><strong>{character.charmPointsLeft}/{character.charmPoints}</strong>
              <span>Arena</span><strong>{character.arenaWins}W / {character.arenaLosses}L</strong>
            </div>
          </div>
          <p className="compact-hint">Equipamento</p>
          <div className="compact-list">
            {Object.entries(character.equipment).map(([slot, item]) => (
              <div className="compact-row" key={slot}>
                <div className="compact-row-main">
                  <ItemSlot itemId={item.id} label={item.name} compact />
                  <span className="compact-row-name">{item.name}</span>
                  <span className="compact-row-meta">{slot}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="compact-hint">Skills</p>
          <div className="compact-list">
            {Object.entries(character.skills).map(([name, skill]) => (
              <div className="compact-row" key={name}>
                <div className="compact-row-main">
                  <span className="compact-row-name">{name}</span>
                </div>
                <span className="compact-row-price">{skill.level}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Charms({ character, busy, onAct }: { character: CharacterView; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const [monsterId, setMonsterId] = useState('');
  const finished = Object.entries(character.bestiary)
    .filter(([id, kills]) => (monstersById.get(id)?.bestiary?.toKill ?? 1) <= kills)
    .map(([id]) => id);

  return (
    <div>
      <p className="lede" style={{ textAlign: 'left' }}>{character.charmPointsLeft} pontos livres · {character.charmPoints} ganhos</p>
      <label>Espécie completada</label>
      <select value={monsterId} onChange={(event) => setMonsterId(event.target.value)}>
        <option value="">escolher…</option>
        {finished.map((id) => <option key={id} value={id}>{monstersById.get(id)?.name ?? id}</option>)}
      </select>
      {charms.map((charm) => {
        const unlocked = character.charmsUnlocked.includes(charm.id);
        const bind = character.charmBinds.find((entry) => entry.charmId === charm.id);
        return (
          <div className="hunt-row" key={charm.id}>
            <div>
              <div>{charm.name} {unlocked ? '✓' : ''}</div>
              <div className="meta">{charm.description} · {charm.points[0]} pts {bind ? `· ${monstersById.get(bind.monsterId)?.name}` : ''}</div>
            </div>
            {!unlocked ? (
              <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'charm-unlock', charmId: charm.id })}>Unlock</button>
            ) : (
              <button className="btn" disabled={busy || !monsterId} onClick={() => void onAct({ type: 'charm-bind', charmId: charm.id, monsterId })}>Bind</button>
            )}
          </div>
        );
      })}
    </div>
  );
}




function Codex({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  const needle = query.trim().toLowerCase();
  const rows = hunts.filter((hunt) => !needle || hunt.name.toLowerCase().includes(needle) || (hunt.location ?? '').toLowerCase().includes(needle));
  return (
    <div>
      <input placeholder="Buscar hunt…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div style={{ marginTop: 10 }}>
        {rows.slice(0, 80).map((hunt) => (
          <div className="hunt-row" key={hunt.id}>
            <div>{hunt.name}<div className="meta">{hunt.location} · lvl {hunt.level} · {hunt.monsters.length} monstros</div></div>
            <b>{formatRate(hunt.expectedXpPerHour)} XP/h</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Daily({ character, busy, onAct }: { character: CharacterView; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const today = new Date().toISOString().slice(0, 10);
  const claimed = character.dailyClaim === today;
  return (
    <div>
      <p>Streak atual: <b>{character.dailyStreak}</b> / 7</p>
      <p className="lede">400 gold × streak, coins extras a partir do dia 3, +1 prey reroll e +10% XP por 2 horas.</p>
      <button className="btn gold" disabled={busy || claimed} onClick={() => void onAct({ type: 'daily' })}>
        {claimed ? 'Já coletado hoje' : 'Coletar'}
      </button>
    </div>
  );
}

const DEPOT_UI_COLS = 5;
const DEPOT_UI_ROWS = 8;

function Warehouse({ character, busy, onAct }: { character: CharacterView; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const [page, setPage] = useState(0);
  const used = character.warehouse.length;
  const uiSlotsPerPage = DEPOT_UI_COLS * DEPOT_UI_ROWS;
  const uiPageCount = Math.ceil(DEPOT_SLOT_CAP / uiSlotsPerPage);
  const safePage = Math.min(Math.max(0, page), uiPageCount - 1);
  const start = safePage * uiSlotsPerPage;
  const pageStacks = character.warehouse.slice(start, start + uiSlotsPerPage);
  const emptySlots = Math.max(0, uiSlotsPerPage - pageStacks.length);

  return (
    <div className="compact-panel depot-panel">
      <div className="depot-toolbar">
        <button className="btn gold" disabled={busy || character.warehouse.length === 0} onClick={() => void onAct({ type: 'warehouse-sell' })}>Coletar (vender tudo)</button>
        <DepotPager page={safePage} pageCount={uiPageCount} onChange={setPage} />
        <span className="compact-hint">{used}/{DEPOT_SLOT_CAP} · pág. {safePage + 1}/{uiPageCount}</span>
      </div>
      <div className="depot-grid-wrap">
        <div className="depot-grid">
        {pageStacks.map((stack) => {
          const item = itemsById.get(stack.itemId);
          const wearable = item ? Boolean(slotFor(item)) : false;
          return (
          <div
            key={stack.itemId}
            onClick={() => void onAct(wearable
              ? { type: 'equip', itemId: stack.itemId, source: 'warehouse' }
              : { type: 'warehouse-withdraw', itemId: stack.itemId, count: 1 })}
          >
            <ItemSlot itemId={stack.itemId} count={stack.count} label={stack.name} />
          </div>
          );
        })}
        {Array.from({ length: emptySlots }, (_, index) => (
          <ItemSlot key={`empty-${safePage}-${index}`} />
        ))}
      </div>
      </div>
    </div>
  );
}

function DepotPager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  return (
    <div className="pouch-pager">
      <button type="button" className="btn" disabled={page <= 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">‹</button>
      <span>{page + 1} / {pageCount}</span>
      <button type="button" className="btn" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)} aria-label="Próxima página">›</button>
    </div>
  );
}

function Merchant({ character, world, busy, onAct }: { character: CharacterView; world: WorldView | null; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const promoted = character.promoted || isPromoted(character.vocation.id);
  return (
    <div>
      <h3>Promoção de vocação</h3>
      <p className="lede" style={{ textAlign: 'left' }}>
        Level {PROMOTION_LEVEL} e {formatNumber(PROMOTION_GOLD)} gold. Regen mais rápido, 200 soul e tick de soul a cada 15s.
      </p>
      <button
        className="btn gold"
        disabled={busy || promoted || character.level < PROMOTION_LEVEL || character.gold < PROMOTION_GOLD}
        onClick={() => void onAct({ type: 'promotion' })}
      >
        {promoted ? 'Já promovido' : `Promover · ${formatNumber(PROMOTION_GOLD)} gold`}
      </button>
      <h3>Comprar</h3>
      {(world?.catalogs.npc ?? []).flatMap((category) => category.items).map((item) => {
        const bulk = (item.buyPrice ?? 0) >= 1000 ? 1 : 20;
        return (
        <div className="hunt-row" key={item.id}>
          <div className="row" style={{ gap: 8 }}>
            <ItemSlot itemId={item.id} label={item.name} />
            <div>{item.name}<div className="meta">{item.buyPrice ? `${formatNumber(item.buyPrice)} gold` : '—'} · {bulk}x</div></div>
          </div>
          <button className="btn" disabled={busy || !item.buyPrice} onClick={() => void onAct({ type: 'npc-buy', itemId: item.id, count: bulk })}>{bulk}x</button>
        </div>
        );
      })}
      <h3 style={{ marginTop: 14 }}>Vender do armazém</h3>
      {character.warehouse.map((stack) => (
        <div className="hunt-row" key={stack.itemId}>
          <div>{stack.name} ×{stack.count}</div>
          <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'npc-sell', itemId: stack.itemId, count: stack.count })}>Vender</button>
        </div>
      ))}
    </div>
  );
}

function bulkBuyCount(buyPrice: number | null, stackable = true): number {
  if (!buyPrice || !stackable) return 1;
  if (buyPrice >= 10_000) return 1;
  if (buyPrice >= 1000) return 5;
  return 20;
}

function GoldMercado({
  character, world, busy, onAct,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const categories = world?.catalogs.npc ?? [];
  const [tab, setTab] = useState(categories[0]?.id ?? 'potions');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const active = categories.find((category) => category.id === tab) ?? categories[0];
  const rows = useMemo(() => {
    const pool = needle
      ? categories.flatMap((category) => category.items.map((item) => ({ ...item, categoryLabel: category.label })))
      : (active?.items ?? []).map((item) => ({ ...item, categoryLabel: active?.label ?? '' }));
    return pool
      .filter((item) => !needle || item.name.toLowerCase().includes(needle) || String(item.id) === needle)
      .sort((a, b) => (a.buyPrice ?? 0) - (b.buyPrice ?? 0) || a.name.localeCompare(b.name));
  }, [categories, active, needle]);

  return (
    <div className="compact-panel">
      <div className="compact-toolbar">
        <span className="compact-gold">{formatNumber(character.gold)} gold</span>
        <input
          className="compact-search"
          placeholder="Buscar…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {!needle && categories.length > 0 && (
        <div className="compact-tabs cy-cats">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={tab === category.id ? 'on' : ''}
              onClick={() => setTab(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}
      <p className="compact-hint">
        Poções, runas e munição → supply pouch · resto → backpack (slot vazio equipa na hora)
        {needle ? ` · ${rows.length} resultado(s)` : active ? ` · ${rows.length} itens` : ''}
      </p>
      <div className="compact-list">
        {rows.length === 0 && <p className="soon">Nenhum item encontrado.</p>}
        {rows.map((item) => {
          const bulk = bulkBuyCount(item.buyPrice);
          const cost = (item.buyPrice ?? 0) * bulk;
          const canAfford = character.gold >= cost;
          const levelOk = character.level >= (item.levelRequired ?? 0);
          return (
            <div className="compact-row" key={`${item.category}-${item.id}`}>
              <div className="compact-row-main">
                <ItemSlot itemId={item.id} label={item.name} compact />
                <span className="compact-row-name" title={item.name}>{item.name}</span>
                <span className="compact-row-price">{formatNumber(item.buyPrice ?? 0)}g</span>
                {bulk > 1 && <span className="compact-row-bulk">{bulk}× {formatNumber(cost)}g</span>}
                {item.levelRequired > 0 && <span className="compact-row-lvl">lvl {item.levelRequired}</span>}
                {needle && item.categoryLabel && <span className="compact-row-cat">{item.categoryLabel}</span>}
              </div>
              <button
                className="btn gold compact-buy"
                disabled={busy || !item.buyPrice || !canAfford || !levelOk}
                title={!levelOk ? `Requer level ${item.levelRequired}` : !canAfford ? 'Gold insuficiente' : undefined}
                onClick={() => void onAct({ type: 'npc-buy', itemId: item.id, count: bulk })}
              >
                {bulk}×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Market({
  character, world, busy, onAct, currency,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  currency: 'gold' | 'coins';
}) {
  const [itemId, setItemId] = useState(character.warehouse[0]?.itemId ?? 0);
  const [price, setPrice] = useState('1000');
  const listings = (world?.market ?? []).filter((row) => row.currency === currency);
  return (
    <div>
      <h3>Anunciar do armazém</h3>
      <select value={itemId} onChange={(event) => setItemId(Number(event.target.value))}>
        {character.warehouse.map((stack) => <option key={stack.itemId} value={stack.itemId}>{stack.name} ×{stack.count}</option>)}
      </select>
      <div className="row" style={{ margin: '8px 0' }}>
        <input value={price} onChange={(event) => setPrice(event.target.value)} />
        <button className="btn gold" disabled={busy || !itemId} onClick={() => void onAct({ type: 'market-list', itemId, count: 1, price: Number(price), currency })}>Listar</button>
      </div>
      <h3>Ofertas</h3>
      {listings.map((listing) => (
        <div className="hunt-row" key={listing.id}>
          <div>{listing.name} ×{listing.count}<div className="meta">{listing.seller}</div></div>
          <button className="btn" disabled={busy} onClick={() => void onAct({ type: 'market-buy', listingId: listing.id })}>
            {formatNumber(listing.price)} {listing.currency}
          </button>
        </div>
      ))}
      {listings.length === 0 && <p className="soon">Nenhuma oferta nesta moeda.</p>}
    </div>
  );
}

function Social({ world, comunidade }: { world: WorldView | null; comunidade?: boolean }) {
  const event = world?.event;
  const active = Boolean(event && (event.experience !== 1 || event.loot !== 1 || event.name));
  return (
    <div>
      {comunidade && (
        <>
          <h3>Evento</h3>
          <p className="lede" style={{ textAlign: 'left' }}>
            {active ? `${event?.name || 'Evento'} · XP ×${event?.experience ?? 1} · loot ×${event?.loot ?? 1}` : 'Nenhum evento ativo'}
          </p>
          <h3>Comunicados</h3>
          {(world?.chat ?? []).slice(-8).map((message) => (
            <div className="hunt-row" key={message.id}>
              <div>{message.body}<div className="meta">{message.author}</div></div>
            </div>
          ))}
          {(world?.chat ?? []).length === 0 && <p className="soon">Nenhum comunicado ainda.</p>}
          <h3 style={{ marginTop: 14 }}>Rank</h3>
          {(world?.ranks.level ?? []).slice(0, 5).map((row, index) => (
            <div className="hunt-row" key={row.id}>
              <div>#{index + 1} {row.name}</div>
              <b>lvl {row.value}</b>
            </div>
          ))}
        </>
      )}
      <h3>{comunidade ? 'Online' : 'Social'}</h3>
      <p className="lede" style={{ textAlign: 'left' }}>{world?.online.length ?? 0} personagens no mundo</p>
      {(world?.online ?? []).map((player) => (
        <div className="hunt-row" key={player.id}>
          <div>{player.name}</div>
          <b>lvl {player.level}</b>
        </div>
      ))}
    </div>
  );
}

function Guild({ character, world, busy, onAct }: { character: CharacterView; world: WorldView | null; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const [name, setName] = useState('');
  const mine = world?.guilds.find((guild) => guild.id === character.guildId);
  const leader = mine && mine.leaderId === character.id;
  return (
    <div>
      {mine ? (
        <div>
          <h3>{mine.name}</h3>
          <p>{mine.motd}</p>
          {mine.members.map((member) => (
            <div className="hunt-row" key={member.characterId}>
              <div>{member.name}<div className="meta">{member.rank}</div></div>
              {leader && member.characterId !== character.id ? (
                <button className="btn danger" disabled={busy} onClick={() => void onAct({ type: 'guild-kick', characterId: member.characterId })}>Expulsar</button>
              ) : <b>{member.rank}</b>}
            </div>
          ))}
          <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void onAct({ type: 'guild-leave' })}>
            {leader && mine.members.length > 1 ? 'Sair (passa a liderança)' : 'Sair da guild'}
          </button>
        </div>
      ) : (
        <div>
          <label>Fundar guild (50.000 gold)</label>
          <div className="row">
            <input value={name} onChange={(event) => setName(event.target.value)} />
            <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'guild-create', name })}>Criar</button>
          </div>
          <h3 style={{ marginTop: 14 }}>Entrar</h3>
          {(world?.guilds ?? []).map((guild) => (
            <div className="hunt-row" key={guild.id}>
              <div>{guild.name}<div className="meta">{guild.members.length} membros</div></div>
              <button className="btn" disabled={busy} onClick={() => void onAct({ type: 'guild-join', guildId: guild.id })}>Entrar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Vip({ character, busy, onAct }: { character: CharacterView; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const active = character.premium && character.vipUntil > Date.now();
  return (
    <div>
      <p>{active ? `Premium até ${new Date(character.vipUntil).toLocaleString('pt-BR')}` : 'Sem Premium Account'}</p>
      <ul>
        <li>4º slot de Prey</li>
        <li>+5% XP</li>
        <li>Stamina 1.5× acima de 39h</li>
      </ul>
      <p>Saldo: {character.coins} TC</p>
      <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'shop', sku: 'vip7' })}>7 dias · 250 TC</button>
      <button className="btn gold" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void onAct({ type: 'shop', sku: 'vip30' })}>30 dias · 900 TC</button>
      <p className="lede" style={{ textAlign: 'left', marginTop: 12 }}>Veja também a aba Store → Premium / VIP na Loja.</p>
    </div>
  );
}

function Rank({ world }: { world: WorldView | null }) {
  const [tab, setTab] = useState<'level' | 'gold' | 'bestiary' | 'skill'>('level');
  const rows = world?.ranks[tab] ?? [];
  return (
    <div>
      <div className="tabs">
        {(['level', 'gold', 'bestiary', 'skill'] as const).map((name) => (
          <button key={name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>
      {rows.map((row, index) => (
        <div className="hunt-row" key={row.id}>
          <div>#{index + 1} {row.name}</div>
          <b>{formatNumber(row.value)}</b>
        </div>
      ))}
    </div>
  );
}

function Admin({ character }: { character: CharacterView }) {
  const [panel, setPanel] = useState<{
    accounts: Array<{ id: number; username: string; admin: boolean; characters: Array<{ id: number; name: string; level: number; gold: number; coins: number }> }>;
    orders: Array<{ id: number; accountId: number; packId: string; coins: number; brl: number; status: string; createdAt: number }>;
    event: { name: string; experience: number; loot: number };
    metrics?: {
      accounts: number;
      characters: number;
      hunting: number;
      queued: number;
      gold: number;
      coins: number;
      beta: string;
      last24h: { dau: number; registers: number; huntsStarted: number; huntsStopped: number; goldFromHunts: number };
      retention: { d1Cohort: number; d1Returned: number; d1: number | null };
      topHunts: Array<{ huntId: string; n: number }>;
    };
    invites?: Array<{ code: string; usedBy: number | null }>;
  } | null>(null);
  const [code, setCode] = useState('BETA-100');
  const [invite, setInvite] = useState('CONVITE-1');
  const [eventName, setEventName] = useState('');

  useEffect(() => {
    void api.admin().then(setPanel).catch(() => undefined);
  }, [character.id]);

  async function run(body: Record<string, unknown>) {
    await api.adminAct(body);
    setPanel(await api.admin());
  }

  if (!character.admin) return <p className="soon">Sem permissão.</p>;
  const metrics = panel?.metrics;

  return (
    <div>
      {metrics && (
        <>
          <h3>Métricas</h3>
          <div className="kv" style={{ marginBottom: 12 }}>
            <span>Contas / chars</span><strong>{metrics.accounts} / {metrics.characters}</strong>
            <span>Caçando / fila</span><strong>{metrics.hunting} / {metrics.queued}</strong>
            <span>Gold / coins</span><strong>{formatNumber(metrics.gold)} / {metrics.coins}</strong>
            <span>DAU 24h</span><strong>{metrics.last24h.dau}</strong>
            <span>Hunts 24h</span><strong>{metrics.last24h.huntsStarted} start · {metrics.last24h.huntsStopped} stop</strong>
            <span>Gold de hunt 24h</span><strong>{formatNumber(metrics.last24h.goldFromHunts)}</strong>
            <span>Retenção D1</span><strong>{metrics.retention.d1 === null ? '—' : `${metrics.retention.d1}% (${metrics.retention.d1Returned}/${metrics.retention.d1Cohort})`}</strong>
            <span>Beta</span><strong>{metrics.beta}</strong>
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="btn gold" onClick={() => void run({ type: 'beta', open: true })}>Beta aberto</button>
            <button className="btn danger" onClick={() => void run({ type: 'beta', open: false })}>Beta fechado</button>
          </div>
        </>
      )}
      <h3>Convites</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={invite} onChange={(event) => setInvite(event.target.value)} />
        <button className="btn" onClick={() => void run({ type: 'invite', code: invite })}>Criar convite</button>
      </div>
      {(panel?.invites ?? []).map((row) => (
        <div className="hunt-row" key={row.code}>
          <div>{row.code}</div>
          <b>{row.usedBy ? 'usado' : 'livre'}</b>
        </div>
      ))}
      <h3 style={{ marginTop: 14 }}>Pedidos de coins</h3>
      {(panel?.orders ?? []).map((order) => (
        <div className="hunt-row" key={order.id}>
          <div>#{order.id} {order.packId}<div className="meta">{order.status} · {order.coins} coins · R$ {order.brl}</div></div>
          {order.status === 'pending' && <button className="btn gold" onClick={() => void run({ type: 'fulfill', orderId: order.id })}>Confirmar Pix</button>}
        </div>
      ))}
      <h3 style={{ marginTop: 14 }}>Código de resgate</h3>
      <div className="row">
        <input value={code} onChange={(event) => setCode(event.target.value)} />
        <button className="btn" onClick={() => void run({ type: 'code', code, coins: 100, gold: 0, vipDays: 0 })}>Criar 100 coins</button>
      </div>
      <h3 style={{ marginTop: 14 }}>Evento</h3>
      <div className="row">
        <input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="Double XP" />
        <button className="btn gold" onClick={() => void run({ type: 'event', name: eventName, experience: 2, loot: 1 })}>2× XP</button>
        <button className="btn" onClick={() => void run({ type: 'event', name: '', experience: 1, loot: 1 })}>Off</button>
      </div>
      <h3 style={{ marginTop: 14 }}>Contas</h3>
      {(panel?.accounts ?? []).map((account) => (
        <div key={account.id}>
          <div className="meta">{account.username}{account.admin ? ' · admin' : ''}</div>
          {account.characters.map((row) => (
            <div className="hunt-row" key={row.id}>
              <div>{row.name}<div className="meta">lvl {row.level} · {formatNumber(row.gold)}g · {row.coins}c</div></div>
              <div className="row" style={{ width: 220 }}>
                <button className="btn" onClick={() => void run({ type: 'grant', characterId: row.id, gold: 10_000, coins: 25 })}>+gold</button>
                <button className="btn danger" onClick={() => void run({ type: 'kick', characterId: row.id })}>kick</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Arena({ character, world, busy, onAct }: { character: CharacterView; world: WorldView | null; busy: boolean; onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  return (
    <div>
      <p>{character.arenaWins}W / {character.arenaLosses}L · luta assíncrona contra o snapshot do outro char.</p>
      {(world?.online ?? []).filter((player) => player.id !== character.id).map((player) => (
        <div className="hunt-row" key={player.id}>
          <div>{player.name}<div className="meta">lvl {player.level}</div></div>
          <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'arena', defenderId: player.id })}>Desafiar</button>
        </div>
      ))}
      <h3 style={{ marginTop: 14 }}>Histórico</h3>
      {(world?.arena ?? []).map((fight, index) => (
        <div className="hunt-row" key={index}>
          <div>{fight.attacker} vs {fight.defender}</div>
          <b>{fight.winner} +{fight.gold}</b>
        </div>
      ))}
    </div>
  );
}
