import { useMemo, useState } from 'react';
import { itemsById, itemsByName } from '@tibia-idle/data';
import {
  IMBUEMENTS,
  IMBUEMENT_BASE_COST,
  IMBUEMENT_CLEAR_COST,
  IMBUEMENT_DURATION_MS,
  type EquipSlot,
} from '@tibia-idle/sim';
import type { CharacterView, WorldView } from '../api/types.js';
import { ItemSlot } from './ItemSlot.js';
import { formatNumber } from '../format.js';
import { uiUrl } from '../ui/chrome.js';

const TIER_LABELS = ['Basic', 'Intricate', 'Powerful'] as const;

const SLOT_LABELS: Record<string, string> = {
  head: 'Capacete',
  armor: 'Armadura',
  right: 'Mão direita',
  left: 'Mão esquerda',
  legs: 'Calças',
  feet: 'Botas',
  backpack: 'Mochila',
  necklace: 'Colar',
  ring: 'Anel',
  ammo: 'Munição',
};

const IMBUE_CATEGORIES: Array<{ id: string; label: string; filter: (spec: CatalogEntry) => boolean }> = [
  { id: 'leech', label: 'Leech & Crit', filter: (s) => ['lifeLeech', 'manaLeech', 'critical'].includes(s.category ?? '') },
  { id: 'elemental', label: 'Conversão elemental', filter: (s) => s.category === 'elemental' },
  { id: 'protect', label: 'Proteção', filter: (s) => (s.category ?? '').startsWith('protect') },
  { id: 'skill', label: 'Skills', filter: (s) => (s.category ?? '').startsWith('skill') || s.category === 'skillMagic' || s.category === 'skillShield' },
  { id: 'utility', label: 'Utilidade', filter: (s) => ['speed', 'capacity', 'vibrancy'].includes(s.category ?? '') },
];

type CatalogEntry = {
  id: string;
  name: string;
  category?: string;
  slots: string[];
  cost: readonly number[];
  description?: readonly string[];
  reagents?: Array<{ name: string; counts: readonly number[] }>;
};

/** Crystal imbuement-icons-64.png is a 11×3 grid (64px cells). */
const IMBUE_ICON_CLIP: Record<string, { x: number; y: number }> = {
  strike: { x: 0, y: 0 },
  vampirism: { x: 1, y: 0 },
  void: { x: 2, y: 0 },
  scorch: { x: 3, y: 0 },
  venom: { x: 4, y: 0 },
  frost: { x: 5, y: 0 },
  electrify: { x: 6, y: 0 },
  reap: { x: 7, y: 0 },
  lich_shroud: { x: 8, y: 0 },
  snake_skin: { x: 9, y: 0 },
  cloud_fabric: { x: 10, y: 0 },
  dragon_hide: { x: 0, y: 1 },
  quara_scale: { x: 1, y: 1 },
  demon_presence: { x: 2, y: 1 },
  precision: { x: 3, y: 1 },
  slash: { x: 4, y: 1 },
  chop: { x: 5, y: 1 },
  bash: { x: 6, y: 1 },
  punch: { x: 7, y: 1 },
  blockade: { x: 8, y: 1 },
  epiphany: { x: 9, y: 1 },
  swiftness: { x: 10, y: 1 },
  featherweight: { x: 0, y: 2 },
  vibrancy: { x: 1, y: 2 },
};

function ImbueIcon({ id, size = 48 }: { id: string; size?: number }) {
  const clip = IMBUE_ICON_CLIP[id] ?? { x: 0, y: 0 };
  const sheet = uiUrl('game/imbuing/imbuement-icons-64');
  return (
    <span
      className="imbue-icon"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${sheet})`,
        backgroundPosition: `-${clip.x * 64}px -${clip.y * 64}px`,
        backgroundSize: `${11 * 64}px ${3 * 64}px`,
      }}
      aria-hidden
    />
  );
}

function equippedPieces(character: CharacterView): Array<{ slot: string; itemId: number; name: string; imbueSlots: number }> {
  return Object.entries(character.equipment)
    .map(([slot, item]) => {
      const data = itemsById.get(item.id);
      const imbueSlots = data?.imbuementSlots ?? 0;
      if (imbueSlots <= 0) return null;
      return { slot, itemId: item.id, name: item.name, imbueSlots };
    })
    .filter(Boolean) as Array<{ slot: string; itemId: number; name: string; imbueSlots: number }>;
}

export function ImbuementPanel({
  character,
  world,
  busy,
  onAct,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const pieces = useMemo(() => equippedPieces(character), [character.equipment]);
  const catalog = (world?.catalogs.imbuements ?? IMBUEMENTS) as CatalogEntry[];

  const [equipSlot, setEquipSlot] = useState<EquipSlot>((pieces[0]?.slot ?? 'left') as EquipSlot);
  const [imbueIndex, setImbueIndex] = useState(0);
  const [category, setCategory] = useState('leech');
  const [selectedId, setSelectedId] = useState('vampirism');
  const [tier, setTier] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const piece = pieces.find((entry) => entry.slot === equipSlot) ?? pieces[0];
  const maxSlots = piece ? piece.imbueSlots : 0;

  const fitted = useMemo(
    () => catalog.filter((entry) => entry.slots.includes(equipSlot)),
    [catalog, equipSlot],
  );

  const categorySpecs = useMemo(() => {
    const cat = IMBUE_CATEGORIES.find((entry) => entry.id === category) ?? IMBUE_CATEGORIES[0]!;
    return fitted.filter(cat.filter);
  }, [fitted, category]);

  const spec = categorySpecs.find((entry) => entry.id === selectedId)
    ?? fitted.find((entry) => entry.id === selectedId)
    ?? categorySpecs[0]
    ?? fitted[0];

  const activeId = spec?.id ?? selectedId;

  const activeOnPiece = character.imbuements.filter(
    (entry) => entry.slot === equipSlot && entry.expiresAt > Date.now(),
  );

  const reagents = (spec?.reagents ?? [])
    .map((reagent) => ({ name: reagent.name, count: reagent.counts[tier - 1] ?? 0 }))
    .filter((entry) => entry.count > 0);

  const warehouseCount = (name: string) => {
    const item = itemsByName.get(name);
    if (!item) return 0;
    const stack = character.warehouse.find((entry) => entry.itemId === item.id);
    return stack?.count ?? 0;
  };

  const goldCost = spec?.cost[tier - 1] ?? IMBUEMENT_BASE_COST[tier - 1] ?? 0;
  const canAffordGold = character.gold >= goldCost;
  const hasReagents = reagents.every((reagent) => warehouseCount(reagent.name) >= reagent.count);
  const huntActive = Boolean(character.session);

  const act = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await onAct(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao imbuir.');
    }
  };

  if (!pieces.length) {
    return (
      <div className="imbue-panel">
        <p className="imbue-lede">
          Equipe um item com slots de imbuement (armas, armaduras, botas, mochila…) para usar o Shrine.
        </p>
        <p className="soon">Nenhum item imbuível equipado.</p>
      </div>
    );
  }

  return (
    <div className="imbue-panel">
      <p className="imbue-lede">
        Shrine Crystal — Basic (7.500 gp), Intricate (60.000 gp), Powerful (250.000 gp).
        Duração <strong>20 horas</strong> de uso. Remover um imbuement: {formatNumber(IMBUEMENT_CLEAR_COST)} gp.
      </p>
      {huntActive && <p className="imbue-warn">Termine a hunt antes de imbuir ou remover imbuements.</p>}

      <div className="imbue-layout">
        <aside className="imbue-items-col">
          <h3>Item equipado</h3>
          <div className="imbue-item-list">
            {pieces.map((entry) => (
              <button
                key={entry.slot}
                type="button"
                className={`imbue-item-row${entry.slot === equipSlot ? ' on' : ''}`}
                onClick={() => {
                  setEquipSlot(entry.slot as EquipSlot);
                  setImbueIndex(0);
                  const next = catalog.find((item) => item.slots.includes(entry.slot));
                  if (next) setSelectedId(next.id);
                }}
              >
                <ItemSlot itemId={entry.itemId} count={0} />
                <div>
                  <strong>{entry.name}</strong>
                  <span className="meta">{SLOT_LABELS[entry.slot] ?? entry.slot} · {entry.imbueSlots} slot(s)</span>
                </div>
              </button>
            ))}
          </div>

          {piece && maxSlots > 1 && (
            <div className="imbue-slot-tabs">
              {Array.from({ length: maxSlots }, (_, index) => {
                const active = activeOnPiece.find((entry) => (entry.index ?? 0) === index);
                return (
                  <button
                    key={index}
                    type="button"
                    className={`imbue-slot-tab${imbueIndex === index ? ' on' : ''}`}
                    onClick={() => setImbueIndex(index)}
                  >
                    Slot {index + 1}
                    {active && <small>{active.type}</small>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="imbue-active-list">
            <h3>Imbuements ativos</h3>
            {character.imbuements.filter((entry) => entry.expiresAt > Date.now()).length === 0 && (
              <p className="soon">Nenhum imbuement ativo.</p>
            )}
            {character.imbuements
              .filter((entry) => entry.expiresAt > Date.now())
              .map((entry) => {
                const imbSpec = catalog.find((item) => item.id === entry.type);
                const itemName = character.equipment[entry.slot]?.name ?? entry.slot;
                return (
                  <div className="imbue-active-row" key={`${entry.slot}-${entry.index ?? 0}-${entry.type}`}>
                    <ImbueIcon id={entry.type} size={32} />
                    <div>
                      <strong>{imbSpec?.name ?? entry.type}</strong>
                      <span className="meta">
                        {TIER_LABELS[entry.tier - 1]} · {itemName}
                        {' · '}{Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 3600000))}h
                      </span>
                    </div>
                    <button
                      className="btn"
                      disabled={busy || huntActive || character.gold < IMBUEMENT_CLEAR_COST}
                      onClick={() => void act({ type: 'imbue-clear', slot: entry.slot, index: entry.index ?? 0 })}
                    >
                      Limpar
                    </button>
                  </div>
                );
              })}
          </div>
        </aside>

        <section className="imbue-main">
          <div className="imbue-categories">
            {IMBUE_CATEGORIES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`imbue-cat-btn${category === entry.id ? ' on' : ''}`}
                onClick={() => {
                  setCategory(entry.id);
                  const first = fitted.find(entry.filter);
                  if (first) setSelectedId(first.id);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="imbue-type-grid">
            {categorySpecs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`imbue-type-card${activeId === entry.id ? ' on' : ''}`}
                onClick={() => setSelectedId(entry.id)}
                title={entry.description?.[2] ?? entry.name}
              >
                <ImbueIcon id={entry.id} size={40} />
                <span>{entry.name}</span>
              </button>
            ))}
          </div>

          {spec && (
            <div className="imbue-detail">
              <h3>{spec.name}</h3>
              <p className="meta">{spec.description?.[tier - 1] ?? ''}</p>

              <div className="imbue-tier-row">
                {[1, 2, 3].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`imbue-tier-btn${tier === value ? ' on' : ''}`}
                    onClick={() => setTier(value)}
                  >
                    {TIER_LABELS[value - 1]}
                    <small>{formatNumber(spec.cost[value - 1] ?? 0)} gp</small>
                  </button>
                ))}
              </div>

              <h4>Materiais (armazém)</h4>
              <div className="imbue-reagents">
                {reagents.map((reagent) => {
                  const have = warehouseCount(reagent.name);
                  const item = itemsByName.get(reagent.name);
                  return (
                    <div className="imbue-reagent" key={reagent.name}>
                      {item && <ItemSlot itemId={item.id} count={0} compact />}
                      <div>
                        <strong>{reagent.name}</strong>
                        <span className={have >= reagent.count ? 'profit' : 'loss'}>
                          {have}/{reagent.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="imbue-cost">
                Gold: <strong className={canAffordGold ? 'profit' : 'loss'}>{formatNumber(goldCost)}</strong>
                {' · '}Duração: {IMBUEMENT_DURATION_MS / 3600000}h
              </p>

              {error && <p className="imbue-error">{error}</p>}

              <button
                className="btn gold imbue-apply-btn"
                disabled={busy || huntActive || !piece || !hasReagents || !canAffordGold}
                onClick={() => void act({ type: 'imbue', slot: equipSlot, imbue: activeId, tier, index: imbueIndex })}
              >
                Imbuir {TIER_LABELS[tier - 1]}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
