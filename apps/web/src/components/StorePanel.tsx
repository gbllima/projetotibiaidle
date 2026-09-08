import { useEffect, useMemo, useState } from 'react';
import { mountsByServerId, outfitsCatalog } from '@tibia-idle/data';
import type { CharacterView, WorldView } from '../api/types.js';
import { formatNumber } from '../format.js';
import { itemIconUrl } from '../render/itemIcon.js';
import { mountIconUrl } from '../render/mountIcon.js';
import { outfitIconUrl } from '../render/outfitIcon.js';

type ShopOfferView = NonNullable<WorldView['catalogs']['shop']>[number];
type StoreCategory = 'vip' | 'outfits' | 'mounts' | 'boosts' | 'services' | 'exercise';
type WalletTab = 'store' | 'coins' | 'convert' | 'transfer';
type OwnFilter = 'all' | 'owned' | 'available';
type SortMode = 'name' | 'price-asc' | 'price-desc';

const CATEGORY_LABELS: Record<StoreCategory, string> = {
  vip: 'Premium / VIP',
  outfits: 'Outfits',
  mounts: 'Montarias',
  boosts: 'Boosts',
  services: 'Serviços',
  exercise: 'Exercise',
};

const ADDON_LABELS = ['Base', 'Addon 1', 'Addon 2', 'Ambos'] as const;

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

function looksForGender(gender: 'm' | 'f'): number[] {
  const opposite = oppositeGenderLooks(gender);
  const looks: number[] = [];
  const seen = new Set<number>();
  for (const entry of outfitsCatalog) {
    const look = gender === 'f' ? entry.female : entry.male;
    if (look == null || opposite.has(look) || seen.has(look)) continue;
    seen.add(look);
    looks.push(look);
  }
  return looks;
}

function formatBoostRemaining(until: number): string {
  if (until <= Date.now()) return 'Inativo';
  const mins = Math.ceil((until - Date.now()) / 60_000);
  if (mins >= 120) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
}

function OutfitPreview({
  lookType,
  label,
  colors,
  addon = 0,
}: {
  lookType: number;
  label: string;
  colors?: { head: number; body: number; legs: number; feet: number } | null;
  addon?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void outfitIconUrl(lookType, 56, colors ?? null, addon).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [lookType, colors?.head, colors?.body, colors?.legs, colors?.feet, addon]);

  return (
    <div className="store-preview outfit-preview" title={label}>
      {src ? <img src={src} alt={label} /> : <span>{label.slice(0, 2)}</span>}
    </div>
  );
}

function ColorDots({ colors }: { colors: { head: number; body: number; legs: number; feet: number } }) {
  return (
    <span className="store-color-dots" title={`cores ${colors.head}/${colors.body}/${colors.legs}/${colors.feet}`}>
      <i style={{ background: `hsl(${(colors.head * 17) % 360} 55% 48%)` }} />
      <i style={{ background: `hsl(${(colors.body * 17) % 360} 55% 48%)` }} />
      <i style={{ background: `hsl(${(colors.legs * 17) % 360} 55% 48%)` }} />
      <i style={{ background: `hsl(${(colors.feet * 17) % 360} 55% 48%)` }} />
    </span>
  );
}

function MountPreview({
  clientid,
  label,
}: {
  clientid: number;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (clientid <= 0) {
      setSrc(null);
      return;
    }
    void mountIconUrl(clientid, 56).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [clientid]);

  return (
    <div className="store-preview mount-preview" title={label}>
      {src ? <img src={src} alt={label} /> : <span>{label.slice(0, 2)}</span>}
    </div>
  );
}

function clientIdForMount(mountId: number, offerClientId?: number): number {
  if (offerClientId && offerClientId > 0) return offerClientId;
  return mountsByServerId.get(mountId)?.clientid ?? 0;
}

function BoostPreview({ kind }: { kind: string }) {
  const icon = kind === 'xp_boost' ? 'XP' : kind === 'loot_boost' ? 'Loot' : 'Gold';
  const tone = kind === 'xp_boost' ? 'xp' : kind === 'loot_boost' ? 'loot' : 'gold';
  return <div className={`store-preview boost-preview ${tone}`}>{icon}</div>;
}

function VipPreview() {
  return <div className="store-preview vip-preview">VIP</div>;
}

function ExercisePreview({ itemId, label }: { itemId: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void itemIconUrl(itemId).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  return (
    <div className="store-preview exercise-preview" title={label}>
      {src ? <img src={src} alt={label} /> : <span>Ex</span>}
    </div>
  );
}

export function StorePanel({
  character,
  world,
  busy,
  onAct,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [walletTab, setWalletTab] = useState<WalletTab>('store');
  const [category, setCategory] = useState<StoreCategory>('mounts');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [ownFilter, setOwnFilter] = useState<OwnFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [previewAddon, setPreviewAddon] = useState(0);
  const [gold, setGold] = useState('10000');
  const [name, setName] = useState(character.name);
  const [code, setCode] = useState('');
  const [transferName, setTransferName] = useState('');
  const [transferCoins, setTransferCoins] = useState('10');

  const offers = world?.catalogs.shop ?? [];
  const equippedOutfit = character.appearance.outfit;
  const equippedMount = character.appearance.mount;
  const equippedAddons = character.appearance.addons ?? 0;
  const gender = character.gender ?? 'm';
  const genderLooks = useMemo(() => new Set(looksForGender(gender)), [gender]);
  const ownedLooksForGender = useMemo(() => {
    const opposite = oppositeGenderLooks(gender);
    return (character.unlockedOutfits ?? []).filter(
      (look) => !opposite.has(look) && (genderLooks.has(look) || look === equippedOutfit),
    );
  }, [character.unlockedOutfits, gender, genderLooks, equippedOutfit]);

  const ownsOutfitOffer = (offer: ShopOfferView) => {
    const looks = [offer.outfitMale, offer.outfitFemale, offer.outfit].filter((id): id is number => id != null);
    return looks.length > 0 && looks.every((id) => character.unlockedOutfits.includes(id));
  };
  const ownedMount = (mount?: number) => mount != null && character.unlockedMounts.includes(mount);
  const lookForOffer = (offer: ShopOfferView) => {
    if (gender === 'f') return offer.outfitFemale ?? 0;
    return offer.outfitMale ?? 0;
  };

  const visible = useMemo(() => {
    const needle = catalogQuery.trim().toLowerCase();
    let list = offers.filter((offer) => {
      if (offer.category !== category) return false;
      if (category === 'outfits' && offer.kind === 'outfit' && lookForOffer(offer) <= 0) return false;
      if ((category === 'outfits' || category === 'mounts') && needle) {
        const hit = offer.name.toLowerCase().includes(needle)
          || offer.description.toLowerCase().includes(needle)
          || String(offer.outfitMale ?? '').includes(needle)
          || String(offer.outfitFemale ?? '').includes(needle)
          || String(offer.mount ?? '').includes(needle)
          || String(offer.mountClientId ?? '').includes(needle);
        if (!hit) return false;
      }
      if (category === 'outfits' || category === 'mounts') {
        const owned = offer.kind === 'outfit' ? ownsOutfitOffer(offer) : ownedMount(offer.mount);
        if (ownFilter === 'owned' && !owned) return false;
        if (ownFilter === 'available' && owned) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortMode === 'price-asc') return a.coins - b.coins;
      if (sortMode === 'price-desc') return b.coins - a.coins;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return list;
  }, [offers, category, catalogQuery, ownFilter, sortMode, character.unlockedOutfits, character.unlockedMounts, gender]);

  const vipActive = character.premium && character.vipUntil > Date.now();
  const now = Date.now();

  return (
    <div className="store-panel">
      <div className="store-head">
        <div>
          <strong>{character.coins} TC</strong>
          <span className="meta"> · {formatNumber(character.gold)} gold</span>
        </div>
        {vipActive && (
          <span className="store-vip-badge">
            Premium até {new Date(character.vipUntil).toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      <div className="store-boosts">
        <span className={(character.storeBoosts?.xp.until ?? 0) > now ? 'on xp' : ''}>
          XP {(character.storeBoosts?.xp.until ?? 0) > now ? `+${Math.round((character.storeBoosts?.xp.bonus ?? 0) * 100)}% · ${formatBoostRemaining(character.storeBoosts!.xp.until)}` : '—'}
        </span>
        <span className={(character.storeBoosts?.loot.until ?? 0) > now ? 'on loot' : ''}>
          Loot {(character.storeBoosts?.loot.until ?? 0) > now ? `+${Math.round((character.storeBoosts?.loot.bonus ?? 0) * 100)}% · ${formatBoostRemaining(character.storeBoosts!.loot.until)}` : '—'}
        </span>
        <span className={(character.storeBoosts?.gold.until ?? 0) > now ? 'on gold' : ''}>
          Gold {(character.storeBoosts?.gold.until ?? 0) > now ? `+${Math.round((character.storeBoosts?.gold.bonus ?? 0) * 100)}% · ${formatBoostRemaining(character.storeBoosts!.gold.until)}` : '—'}
        </span>
      </div>

      <div className="tabs store-wallet-tabs">
        <button type="button" className={walletTab === 'store' ? 'on' : ''} onClick={() => setWalletTab('store')}>Store</button>
        <button type="button" className={walletTab === 'coins' ? 'on' : ''} onClick={() => setWalletTab('coins')}>Obter TC</button>
        <button type="button" className={walletTab === 'convert' ? 'on' : ''} onClick={() => setWalletTab('convert')}>Converter</button>
        <button type="button" className={walletTab === 'transfer' ? 'on' : ''} onClick={() => setWalletTab('transfer')}>Transferir</button>
      </div>

      {walletTab === 'store' && (
        <>
          <div className="store-category-tabs">
            {(Object.keys(CATEGORY_LABELS) as StoreCategory[]).map((key) => (
              <button
                key={key}
                type="button"
                className={category === key ? 'on' : ''}
                onClick={() => setCategory(key)}
              >
                {CATEGORY_LABELS[key]}
              </button>
            ))}
          </div>

          {(category === 'outfits' || category === 'mounts') && (
            <div className="store-filters">
              <input
                className="store-outfit-search"
                placeholder={category === 'outfits'
                  ? 'Buscar outfit (Citizen, Dragon Knight…)'
                  : 'Buscar montaria (War Horse, Dragonling…)'}
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
              />
              <div className="store-filter-row">
                <select value={ownFilter} onChange={(event) => setOwnFilter(event.target.value as OwnFilter)}>
                  <option value="all">Todos</option>
                  <option value="available">Disponíveis</option>
                  <option value="owned">Adquiridos</option>
                </select>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                  <option value="name">Nome</option>
                  <option value="price-asc">Preço ↑</option>
                  <option value="price-desc">Preço ↓</option>
                </select>
              </div>
              {category === 'outfits' && (
                <div className="store-addon-row">
                  <span className="meta">Preview addon:</span>
                  {ADDON_LABELS.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      className={previewAddon === index ? 'on' : ''}
                      onClick={() => setPreviewAddon(index)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {category === 'vip' && (
            <p className="store-category-hint">
              Premium Account: +5% XP, 4º slot de Prey, stamina 1.5× acima de 39h.
            </p>
          )}

          {category === 'outfits' && (
            <p className="store-category-hint">
              {visible.length} outfits · só {gender === 'f' ? '♀ feminino' : '♂ masculino'} · {ADDON_LABELS[previewAddon]} · compra libera o par
            </p>
          )}

          {category === 'mounts' && (
            <p className="store-category-hint">
              {visible.length} montarias · sprites reais do cliente · compra desbloqueia e equipa
            </p>
          )}

          {category === 'boosts' && (
            <p className="store-category-hint">
              Loot Boost = valor de itens. Gold Boost = só moedas (gold/platinum/crystal).
            </p>
          )}

          {category === 'exercise' && (
            <p className="store-category-hint">
              Armas de exercise vão para o supply pouch. Use no Treino online: +7 tries a cada 2s por carga.
            </p>
          )}

          {(category === 'outfits' || category === 'mounts') && (
            <div className="store-owned-bar">
              {category === 'outfits' && (
                <>
                  {ownedLooksForGender.map((lookType) => (
                    <button
                      key={lookType}
                      type="button"
                      className={`store-owned-chip ${equippedOutfit === lookType ? 'on' : ''}`}
                      disabled={busy}
                      onClick={() => void onAct({ type: 'shop-equip', kind: 'outfit', id: lookType })}
                    >
                      <OutfitPreview
                        lookType={lookType}
                        label={`Outfit ${lookType}`}
                        colors={character.appearance}
                        addon={equippedAddons}
                      />
                    </button>
                  ))}
                  <div className="store-addon-equip">
                    <span className="meta">Addons equipados:</span>
                    {ADDON_LABELS.map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        className={equippedAddons === index ? 'on' : ''}
                        disabled={busy}
                        onClick={() => void onAct({ type: 'shop-equip', kind: 'addons', id: index })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {category === 'mounts' && (
                <>
                  {character.unlockedMounts?.map((mount) => {
                    const clientid = clientIdForMount(mount);
                    return (
                      <button
                        key={mount}
                        type="button"
                        className={`store-owned-chip ${equippedMount === mount ? 'on' : ''}`}
                        disabled={busy || clientid <= 0}
                        onClick={() => void onAct({ type: 'shop-equip', kind: 'mount', id: mount })}
                      >
                        <MountPreview
                          clientid={clientid}
                          label={mountsByServerId.get(mount)?.name ?? `Mount ${mount}`}
                        />
                      </button>
                    );
                  })}
                  {equippedMount > 0 && (
                    <button
                      type="button"
                      className="btn store-clear-mount"
                      disabled={busy}
                      onClick={() => void onAct({ type: 'shop-equip', kind: 'mount-clear' })}
                    >
                      Sem montaria
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="store-offers">
            {visible.length === 0 && <p className="soon">Nenhuma oferta nesta categoria.</p>}
            {visible.map((offer) => (
              <StoreOfferRow
                key={offer.id}
                offer={offer}
                character={character}
                busy={busy}
                rename={name}
                onRename={setName}
                lookType={lookForOffer(offer)}
                previewAddon={previewAddon}
                owned={
                  (offer.kind === 'outfit' && ownsOutfitOffer(offer))
                  || (offer.kind === 'mount' && ownedMount(offer.mount))
                }
                onAct={onAct}
              />
            ))}
          </div>
        </>
      )}

      {walletTab === 'coins' && (
        <div className="store-wallet-pane">
          <p className="lede store-pane-hint">Pedido Pix fica pendente até um admin confirmar. Resgate imediato com código.</p>
          {(world?.catalogs.packs ?? []).map((pack) => (
            <div className="store-offer-row" key={pack.id}>
              <div>
                <strong>{pack.name}</strong>
                <div className="meta">R$ {pack.brl}</div>
              </div>
              <button type="button" className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'buy-coins', pack: pack.id })}>Pedir</button>
            </div>
          ))}
          <label>Resgatar código</label>
          <div className="row">
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="CODIGO-XXXX" />
            <button type="button" className="btn" disabled={busy || !code.trim()} onClick={() => void onAct({ type: 'redeem', code })}>Resgatar</button>
          </div>
        </div>
      )}

      {walletTab === 'convert' && (
        <div className="store-wallet-pane">
          <label>Converter gold → TC (10.000 = 1)</label>
          <div className="row">
            <input value={gold} onChange={(event) => setGold(event.target.value)} />
            <button type="button" className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'convert', gold: Number(gold) })}>Converter</button>
          </div>
        </div>
      )}

      {walletTab === 'transfer' && (
        <div className="store-wallet-pane">
          <p className="lede store-pane-hint">Envia TC para outro personagem pelo nome.</p>
          <label>Personagem</label>
          <input value={transferName} onChange={(event) => setTransferName(event.target.value)} placeholder="Nome" />
          <label>TC</label>
          <div className="row">
            <input value={transferCoins} onChange={(event) => setTransferCoins(event.target.value)} />
            <button
              type="button"
              className="btn gold"
              disabled={busy || !transferName.trim()}
              onClick={() => void onAct({ type: 'transfer', name: transferName.trim(), coins: Number(transferCoins) })}
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreOfferRow({
  offer,
  character,
  busy,
  rename,
  onRename,
  lookType,
  previewAddon,
  owned,
  onAct,
}: {
  offer: ShopOfferView;
  character: CharacterView;
  busy: boolean;
  rename: string;
  onRename: (value: string) => void;
  lookType: number;
  previewAddon: number;
  owned: boolean;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const canAfford = character.coins >= offer.coins;

  return (
    <div className="store-offer-row">
      <div className="store-offer-main">
        {offer.kind === 'outfit' && lookType > 0 && (
          <OutfitPreview lookType={lookType} label={offer.name} colors={offer.colors} addon={previewAddon} />
        )}
        {offer.kind === 'mount' && (offer.mountClientId ?? offer.mount) != null && (
          <MountPreview
            clientid={clientIdForMount(offer.mount ?? 0, offer.mountClientId)}
            label={offer.name}
          />
        )}
        {(offer.kind === 'xp_boost' || offer.kind === 'loot_boost' || offer.kind === 'gold_boost') && (
          <BoostPreview kind={offer.kind} />
        )}
        {offer.kind === 'vip' && <VipPreview />}
        {offer.kind === 'exercise' && offer.itemId != null && (
          <ExercisePreview itemId={offer.itemId} label={offer.name} />
        )}
        {offer.kind !== 'outfit' && offer.kind !== 'mount' && offer.kind !== 'vip' && offer.kind !== 'exercise'
          && !offer.kind.includes('boost') && (
          <div className="store-preview service-preview">★</div>
        )}

        <div className="store-offer-copy">
          <strong>
            {offer.name}
            {offer.colors && <ColorDots colors={offer.colors} />}
          </strong>
          <div className="meta">{offer.description}</div>
          <div className="store-offer-price">{offer.coins} TC</div>
        </div>
      </div>

      {offer.kind === 'rename' ? (
        <div className="row store-offer-action">
          <input value={rename} onChange={(event) => onRename(event.target.value)} />
          <button type="button" className="btn gold" disabled={busy || !canAfford} onClick={() => void onAct({ type: 'shop', sku: offer.id, name: rename })}>
            Comprar
          </button>
        </div>
      ) : owned ? (
        <button type="button" className="btn" disabled>Adquirido</button>
      ) : (
        <button
          type="button"
          className="btn gold"
          disabled={busy || !canAfford}
          onClick={() => void onAct({ type: 'shop', sku: offer.id })}
        >
          Comprar
        </button>
      )}
    </div>
  );
}
