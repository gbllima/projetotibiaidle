import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { mountsCatalog, mountsByServerId, outfitsCatalog } from '@tibia-idle/data';
import type { CharacterView } from '../api/types.js';
import { mountIconUrl } from '../render/mountIcon.js';
import { tibiaColorCss } from '../render/outfit.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { WindowHead } from './WindowHead.js';

type ColorPart = 'head' | 'body' | 'legs' | 'feet';
export type OutfitDraft = {
  outfit: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
  aura: number;
};

const COLOR_PARTS: Array<{ id: ColorPart; label: string }> = [
  { id: 'head', label: 'Cabeça' },
  { id: 'body', label: 'Primária' },
  { id: 'legs', label: 'Secundária' },
  { id: 'feet', label: 'Detalhe' },
];

const COLOR_IDS = Array.from({ length: 133 }, (_, i) => i);

function lookForGender(entry: (typeof outfitsCatalog)[number], gender: 'm' | 'f'): number | null {
  if (gender === 'f') return entry.female ?? null;
  return entry.male ?? null;
}

/** LookTypes that belong to the other sex — never list/equip these on this character. */
function oppositeGenderLooks(gender: 'm' | 'f'): Set<number> {
  const opposite = new Set<number>();
  for (const entry of outfitsCatalog) {
    if (gender === 'm') {
      if (entry.female != null && entry.female !== entry.male) opposite.add(entry.female);
    } else if (entry.male != null && entry.male !== entry.female) {
      opposite.add(entry.male);
    }
  }
  return opposite;
}

function isFreeOutfit(entry: (typeof outfitsCatalog)[number]): boolean {
  return entry.unlocked === true || entry.from === 'default';
}

function outfitName(lookType: number): string {
  for (const entry of outfitsCatalog) {
    if (entry.male === lookType || entry.female === lookType || entry.outfit === lookType) {
      return entry.name;
    }
  }
  return `Outfit ${lookType}`;
}

function fromAppearance(character: CharacterView): OutfitDraft {
  const a = character.appearance;
  return {
    outfit: a.outfit,
    head: a.head,
    body: a.body,
    legs: a.legs,
    feet: a.feet,
    addons: a.addons ?? 0,
    mount: a.mount ?? 0,
    aura: a.aura ?? 0,
  };
}

function ownedOutfitSet(character: CharacterView, gender: 'm' | 'f'): Set<number> {
  const opposite = oppositeGenderLooks(gender);
  const owned = new Set<number>();
  for (const look of character.unlockedOutfits ?? []) {
    if (!opposite.has(look)) owned.add(look);
  }
  if (!opposite.has(character.appearance.outfit)) owned.add(character.appearance.outfit);
  for (const entry of outfitsCatalog) {
    if (!isFreeOutfit(entry)) continue;
    const look = lookForGender(entry, gender);
    if (look != null) owned.add(look);
  }
  return owned;
}

function Preview({
  draft,
  direction,
  showMount,
}: {
  draft: OutfitDraft;
  direction: number;
  showMount: boolean;
}) {
  // Defer heavy sprite rebuild so checkbox clicks stay instant.
  const live = useDeferredValue(draft);
  const liveDirection = useDeferredValue(direction);
  const liveShowMount = useDeferredValue(showMount);
  const [outfitSrc, setOutfitSrc] = useState<string | null>(null);
  const [mountSrc, setMountSrc] = useState<string | null>(null);

  const mountedPreview = liveShowMount && live.mount > 0;

  useEffect(() => {
    let active = true;
    void outfitIconUrl(live.outfit, 96, live, live.addons, liveDirection, mountedPreview).then((url) => {
      if (active) setOutfitSrc(url);
    });
    return () => {
      active = false;
    };
  }, [live.outfit, live.head, live.body, live.legs, live.feet, live.addons, liveDirection, mountedPreview]);

  useEffect(() => {
    let active = true;
    if (!liveShowMount || live.mount <= 0) {
      setMountSrc(null);
      return;
    }
    const clientid = mountsByServerId.get(live.mount)?.clientid ?? 0;
    if (clientid <= 0) {
      setMountSrc(null);
      return;
    }
    void mountIconUrl(clientid, 96).then((url) => {
      if (active) setMountSrc(url);
    });
    return () => {
      active = false;
    };
  }, [live.mount, liveShowMount]);

  const mounted = Boolean(liveShowMount && live.mount > 0 && mountSrc);

  return (
    <div className={`outfit-preview-stage ${mounted ? 'mounted' : ''}`}>
      {mounted && <img className="outfit-mount-layer" src={mountSrc!} alt="" draggable={false} />}
      {outfitSrc
        ? <img className="outfit-char-layer" src={outfitSrc} alt="preview" draggable={false} />
        : <span className="meta">…</span>}
    </div>
  );
}

export function OutfitModal({
  character,
  busy,
  onClose,
  onApply,
  onPresetSave,
  onPresetLoad,
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onApply: (draft: OutfitDraft) => Promise<void>;
  onPresetSave: (slot: number) => Promise<void>;
  onPresetLoad: (slot: number) => Promise<OutfitDraft | void>;
}) {
  // Local draft only — do NOT resync from live character ticks (that was wiping colors/addons).
  const [draft, setDraft] = useState<OutfitDraft>(() => fromAppearance(character));
  const [direction, setDirection] = useState(2);
  const [colorPart, setColorPart] = useState<ColorPart>('head');
  const [tab, setTab] = useState<'outfit' | 'mount' | 'presets'>('outfit');
  const [showMount, setShowMount] = useState((character.appearance.mount ?? 0) > 0);
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState('');
  // List thumbs follow palette colors, but deferred so the color grid stays snappy.
  const listColors = useDeferredValue({
    head: draft.head,
    body: draft.body,
    legs: draft.legs,
    feet: draft.feet,
  });

  const gender = character.gender ?? 'm';
  const ownedOutfits = useMemo(() => ownedOutfitSet(character, gender), [character.unlockedOutfits, character.appearance.outfit, gender]);
  const ownedMounts = useMemo(() => new Set(character.unlockedMounts ?? []), [character.unlockedMounts]);

  const outfitList = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const opposite = oppositeGenderLooks(gender);
    const rows: Array<{ lookType: number; name: string; owned: boolean; coins: number }> = [];
    const seen = new Set<number>();

    for (const entry of outfitsCatalog) {
      const lookType = lookForGender(entry, gender);
      if (lookType == null || seen.has(lookType) || opposite.has(lookType)) continue;
      seen.add(lookType);
      const owned = ownedOutfits.has(lookType) || isFreeOutfit(entry);
      rows.push({ lookType, name: entry.name, owned, coins: entry.coins });
    }

    // Extra unlocked looks for this gender only (never the other sex).
    for (const lookType of ownedOutfits) {
      if (seen.has(lookType) || opposite.has(lookType)) continue;
      seen.add(lookType);
      rows.push({ lookType, name: outfitName(lookType), owned: true, coins: 0 });
    }

    return rows
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || String(entry.lookType).includes(needle))
      .sort((a, b) => {
        if (a.owned !== b.owned) return a.owned ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [gender, ownedOutfits, query]);

  const mountList = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = [
      { mount: 0, name: 'Sem montaria', clientid: 0, owned: true, coins: 0 },
      ...mountsCatalog.map((entry) => ({
        mount: entry.mount,
        name: entry.name,
        clientid: entry.clientid,
        owned: ownedMounts.has(entry.mount),
        coins: entry.coins,
      })),
    ];
    return rows
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || String(entry.mount).includes(needle))
      .sort((a, b) => {
        if (a.mount === 0) return -1;
        if (b.mount === 0) return 1;
        if (a.owned !== b.owned) return a.owned ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [ownedMounts, query]);

  const patch = (partial: Partial<OutfitDraft>) => {
    setHint('');
    setDraft((current) => ({ ...current, ...partial }));
  };

  const toggleAddon = (bit: 1 | 2) => {
    setHint('');
    setDraft((current) => ({
      ...current,
      addons: (current.addons & bit) ? (current.addons & ~bit) : (current.addons | bit),
    }));
  };

  const randomizeColors = () => {
    patch({
      head: Math.floor(Math.random() * 133),
      body: Math.floor(Math.random() * 133),
      legs: Math.floor(Math.random() * 133),
      feet: Math.floor(Math.random() * 133),
    });
  };

  const selectOutfit = (lookType: number, owned: boolean) => {
    if (!owned) {
      setHint('Outfit bloqueado — compre na Store (Loja).');
      return;
    }
    patch({ outfit: lookType });
  };

  const selectMount = (mount: number, owned: boolean) => {
    if (!owned) {
      setHint('Montaria bloqueada — compre na Store (Loja).');
      return;
    }
    patch({ mount });
    setShowMount(mount > 0);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card outfit-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead title="Personalizar personagem" onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">

        <div className="outfit-layout">
          <div className="outfit-preview-col">
            <Preview draft={draft} direction={direction} showMount={showMount && draft.mount > 0} />
            <div className="outfit-rotate">
              <button type="button" className="btn" onClick={() => setDirection((d) => (d + 3) % 4)} aria-label="Girar esquerda">⟲</button>
              <button type="button" className="btn" onClick={() => setDirection((d) => (d + 1) % 4)} aria-label="Girar direita">⟳</button>
            </div>
            <label className="outfit-check">
              <input
                type="checkbox"
                checked={showMount && draft.mount > 0}
                disabled={draft.mount <= 0}
                onChange={(event) => {
                  if (event.target.checked) {
                    if (draft.mount <= 0) {
                      setHint('Selecione uma montaria na aba Mount.');
                      setTab('mount');
                      return;
                    }
                    setShowMount(true);
                  } else {
                    setShowMount(false);
                  }
                }}
              />
              Montado
            </label>
            <div className="outfit-addon-checks">
              <label className="outfit-check">
                <input type="checkbox" checked={Boolean(draft.addons & 1)} onChange={() => toggleAddon(1)} />
                Addon 1
              </label>
              <label className="outfit-check">
                <input type="checkbox" checked={Boolean(draft.addons & 2)} onChange={() => toggleAddon(2)} />
                Addon 2
              </label>
            </div>
            <button type="button" className="btn" onClick={randomizeColors}>Randomizar cores</button>
            {hint && <p className="outfit-hint">{hint}</p>}
          </div>

          <div className="outfit-controls">
            <div className="tabs outfit-tabs">
              <button type="button" className={tab === 'outfit' ? 'on' : ''} onClick={() => { setTab('outfit'); setQuery(''); }}>
                Outfit ({outfitList.filter((e) => e.owned).length}/{outfitList.length})
              </button>
              <button type="button" className={tab === 'mount' ? 'on' : ''} onClick={() => { setTab('mount'); setQuery(''); }}>
                Montaria ({Math.max(0, mountList.filter((e) => e.owned && e.mount > 0).length)}/{Math.max(0, mountList.length - 1)})
              </button>
              <button type="button" className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>Presets</button>
            </div>

            {(tab === 'outfit' || tab === 'mount') && (
              <input
                className="outfit-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tab === 'outfit' ? 'Buscar outfit…' : 'Buscar montaria…'}
              />
            )}

            {tab === 'outfit' && (
              <div className="outfit-list">
                {outfitList.length === 0 && <p className="soon">Nenhum outfit encontrado.</p>}
                {outfitList.map((entry) => (
                  <button
                    key={entry.lookType}
                    type="button"
                    className={`outfit-list-item ${draft.outfit === entry.lookType ? 'on' : ''} ${entry.owned ? '' : 'locked'}`}
                    onClick={() => selectOutfit(entry.lookType, entry.owned)}
                  >
                    <OutfitThumb lookType={entry.lookType} colors={listColors} />
                    <span className="outfit-list-copy">
                      <strong>{entry.name}</strong>
                      <em>{entry.owned ? `look ${entry.lookType}` : `${entry.coins} TC`}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'mount' && (
              <div className="outfit-list">
                {mountList.map((entry) => (
                  <button
                    key={entry.mount}
                    type="button"
                    className={`outfit-list-item ${draft.mount === entry.mount ? 'on' : ''} ${entry.owned ? '' : 'locked'}`}
                    onClick={() => selectMount(entry.mount, entry.owned)}
                  >
                    <MountThumb clientid={entry.clientid} />
                    <span className="outfit-list-copy">
                      <strong>{entry.name}</strong>
                      <em>{entry.mount === 0 ? 'dismount' : entry.owned ? `id ${entry.mount}` : `${entry.coins} TC`}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'presets' && (
              <div className="outfit-presets">
                {[0, 1, 2].map((slot) => {
                  const preset = character.appearancePresets?.[slot];
                  return (
                    <div key={slot} className="outfit-preset-row">
                      <strong>Preset {slot + 1}</strong>
                      <span className="meta">{preset ? `look ${preset.outfit}` : 'vazio'}</span>
                      <button type="button" className="btn" disabled={busy} onClick={() => void onPresetSave(slot)}>Salvar</button>
                      <button
                        type="button"
                        className="btn gold"
                        disabled={busy || !preset}
                        onClick={() => void onPresetLoad(slot).then((next) => {
                          if (next) {
                            setDraft(next);
                            setShowMount(next.mount > 0);
                          }
                        })}
                      >
                        Carregar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="outfit-color-parts">
              {COLOR_PARTS.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className={colorPart === part.id ? 'on' : ''}
                  onClick={() => setColorPart(part.id)}
                >
                  <i style={{ background: tibiaColorCss(draft[part.id]) }} />
                  {part.label}
                </button>
              ))}
            </div>

            <div className="outfit-color-grid" role="listbox" aria-label="Paleta de cores">
              {COLOR_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={draft[colorPart] === id ? 'on' : ''}
                  style={{ background: tibiaColorCss(id) }}
                  title={`Cor ${id}`}
                  onClick={() => patch({ [colorPart]: id })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="outfit-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="btn gold"
            disabled={busy}
            onClick={() => {
              // Montado controls whether the equipped mount is applied in-game.
              const payload: OutfitDraft = {
                ...draft,
                mount: showMount && draft.mount > 0 ? draft.mount : 0,
              };
              void onApply(payload).catch((error: unknown) => {
                setHint(error instanceof Error ? error.message : 'Falha ao aplicar aparência.');
              });
            }}
          >
            Aplicar
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

/** List thumbs share the preview palette (base look, no addon composite — keeps UI fast). */
const OutfitThumb = memo(function OutfitThumb({
  lookType,
  colors,
}: {
  lookType: number;
  colors: { head: number; body: number; legs: number; feet: number };
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void outfitIconUrl(lookType, 40, colors, 0).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [lookType, colors.head, colors.body, colors.legs, colors.feet]);
  return (
    <span className="outfit-thumb">
      {src ? <img src={src} alt="" /> : <span>{lookType}</span>}
    </span>
  );
});

const MountThumb = memo(function MountThumb({ clientid }: { clientid: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (clientid <= 0) {
      setSrc(null);
      return;
    }
    void mountIconUrl(clientid, 40).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [clientid]);
  return (
    <span className="outfit-thumb">
      {src ? <img src={src} alt="" /> : <span>—</span>}
    </span>
  );
});
