import { useEffect, useMemo, useState } from 'react';
import type { BossView, CharacterView, HuntView } from '../api/types.js';
import { buildHuntRegions, sortHunts } from '../huntLocations.js';
import { formatNumber, formatRate } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import type { MessageKey } from '../i18n/strings.js';
import { HuntDetailsModal } from './HuntDetailsModal.js';
import { CreatureIcon } from './CreatureIcon.js';
import { WindowHead } from './WindowHead.js';
import { itemIconUrl } from '../render/itemIcon.js';

function TrainingItemIcon({ itemId, size = 40 }: { itemId: number; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void itemIconUrl(itemId).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [itemId]);
  if (!src) return <span className="creature-icon-fallback" style={{ width: size, height: size }}>?</span>;
  return <img src={src} alt="" width={size} height={size} className="training-item-icon" />;
}

import { TRAINING_DUMMIES, TRAINING_ROOMS, trainingDummy } from '../trainingRooms.js';

type HuntTab = 'hunts' | 'training' | BossView['category'];

const BOSS_TAB_LABELS: Record<BossView['category'], string> = {
  boss: 'Bosses',
  raid: 'Raids de mundo',
  event: 'Eventos',
};

function formatCooldownMs(ms: number): string {
  if (ms <= 0) return '';
  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function HuntModal({
  hunts,
  bosses,
  character,
  hunting,
  busy,
  error,
  initialTab = 'hunts',
  onStart,
  onStop,
  onEnterTraining,
  onCity,
  onClose,
}: {
  hunts: HuntView[];
  bosses: BossView[];
  character: CharacterView;
  hunting: boolean;
  busy: boolean;
  error?: string;
  initialTab?: 'hunts' | 'training';
  onStart: (id: string, hours: number) => void;
  onStop: () => void;
  onCity: () => void;
  onEnterTraining: (roomId: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const occupied = hunting || Boolean(character.queue);
  const currentId = character.session?.huntId ?? character.queue?.huntId ?? null;
  const [tab, setTab] = useState<HuntTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [detailHunt, setDetailHunt] = useState<HuntView | null>(null);
  const [query, setQuery] = useState('');
  const [hours, setHours] = useState(1);
  const [regionName, setRegionName] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const regions = useMemo(() => buildHuntRegions(hunts), [hunts]);
  const searching = query.trim().length > 0;
  const bossMode = tab !== 'hunts' && tab !== 'training';
  const trainingMode = tab === 'training';

  useEffect(() => {
    if (bossMode || showAll || location || regionName || searching) return;
    if (regions[0]) setRegionName(regions[0].name);
  }, [regions, regionName, location, showAll, searching, bossMode]);

  const visibleHunts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return hunts
      .filter((hunt) => {
        if (needle) {
          return hunt.name.toLowerCase().includes(needle)
            || hunt.location?.toLowerCase().includes(needle)
            || hunt.monsters.some((monster) => monster.toLowerCase().includes(needle));
        }
        if (location) return (hunt.location || 'Outros') === location;
        if (!showAll && regionName) {
          const region = regions.find((entry) => entry.name === regionName);
          return region?.locations.some((entry) => entry.location === (hunt.location || 'Outros')) ?? false;
        }
        return showAll;
      })
      .sort(sortHunts);
  }, [hunts, query, location, regionName, regions, showAll]);

  const visibleBosses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bosses
      .filter((boss) => boss.category === tab)
      .filter((boss) => {
        if (!needle) return true;
        return boss.name.toLowerCase().includes(needle)
          || boss.location.toLowerCase().includes(needle)
          || boss.description.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
  }, [bosses, tab, query]);

  const bossCounts = useMemo(() => ({
    boss: bosses.filter((entry) => entry.category === 'boss').length,
    raid: bosses.filter((entry) => entry.category === 'raid').length,
    event: bosses.filter((entry) => entry.category === 'event').length,
  }), [bosses]);

  const activeRegion = regionName ?? regions[0]?.name ?? null;
  const activeLocations = regions.find((entry) => entry.name === activeRegion)?.locations ?? [];

  const pickRegion = (name: string) => {
    setShowAll(false);
    setRegionName(name);
    setLocation(null);
  };

  const pickLocation = (next: string) => {
    setShowAll(false);
    setLocation(next);
    const region = regions.find((entry) => entry.locations.some((row) => row.location === next));
    if (region) setRegionName(region.name);
  };

  const clearFilters = () => {
    setShowAll(true);
    setRegionName(null);
    setLocation(null);
    setQuery('');
  };

  const switchTab = (next: HuntTab) => {
    setTab(next);
    setQuery('');
    if (next !== 'hunts') {
      setShowAll(false);
      setLocation(null);
      setRegionName(null);
    }
    if (next === 'training') {
      setQuery('');
    }
  };

  return (
    <>
    <div className="modal" onClick={onClose}>
      <div className="modal-card wide hunt-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead title={t('hunts')} onClose={onClose} closeLabel={t('close')} />

        <div className="hunt-modal-body">
        <div className="hunt-tab-bar">
          <button type="button" data-tab="hunts" className={`hunt-tab ${tab === 'hunts' ? 'on' : ''}`} onClick={() => switchTab('hunts')}>
            Hunts
            <span>{hunts.length}</span>
          </button>
          <button type="button" data-tab="training" className={`hunt-tab ${tab === 'training' ? 'on' : ''}`} onClick={() => switchTab('training')}>
            Treino online
            <span>{TRAINING_ROOMS.length}</span>
          </button>
          {(['boss', 'raid', 'event'] as const).map((category) => (
            <button
              key={category}
              type="button"
              data-tab={category}
              className={`hunt-tab ${tab === category ? 'on' : ''}`}
              onClick={() => switchTab(category)}
            >
              {BOSS_TAB_LABELS[category]}
              <span>{bossCounts[category]}</span>
            </button>
          ))}
        </div>

        <input
          className="hunt-modal-search"
          placeholder={trainingMode ? 'Buscar sala ou dummy…' : bossMode ? 'Buscar boss, raid ou evento…' : t('searchHunt')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {trainingMode && (
          <div className="hunt-callout training-callout">
            <div className="hunt-callout-copy">
              <strong>Salas de treino premium</strong>
              <p>
                Dummies extraídos do cliente Tibia. Enquanto você não caça, o dummy offline treina automaticamente
                (1 try / 8s · teto 8h).
              </p>
            </div>
            <div className="hunt-callout-tags">
              <span className="hunt-tag skill">Skill {character.dummySkill}</span>
              <span className="hunt-tag">+7 exercise / 2s</span>
              {character.exerciseCharges ? (
                <span className="hunt-tag gold">{character.exerciseCharges.toLocaleString()} cargas</span>
              ) : null}
            </div>
          </div>
        )}

        {!bossMode && !trainingMode && (
          <>
            <div className="hunt-hours-bar box-tools">
              {([1, 4, 8, 24] as const).map((value) => (
                <button
                  key={value}
                  className={`btn hunt-hour-btn ${hours === value ? 'gold on' : ''}`}
                  type="button"
                  onClick={() => setHours(value)}
                >
                  {value}h
                </button>
              ))}
            </div>
            <p className="hunt-callout-inline hunt-modal-hint">{t('supplyHours')}</p>
          </>
        )}

        {bossMode && (
          <div className="hunt-callout boss-callout">
            <p>
              {tab === 'boss'
                ? 'Bosses de alavanca e quests — 1 kill por luta, cooldown de 20 horas.'
                : tab === 'raid'
                  ? 'Raids de mundo — spawns anunciados (demônios, Morshabaal, etc.).'
                  : 'Bosses de eventos sazonais e especiais.'}
            </p>
          </div>
        )}

        {occupied && <p className="lede hunt-modal-hint">{t('switchHint')}</p>}
        {occupied && (
          <button className="btn danger hunt-stop-btn" type="button" disabled={busy} onClick={onStop}>
            {character.queue ? t('leaveQueue') : t('stopHunt')}
          </button>
        )}
        {error && <p className="error">{error}</p>}

        {trainingMode ? (
          <div className="training-browser">
            <div className="hunt-list-head">
              <strong>Salas de treino</strong>
              <span>{TRAINING_DUMMIES.length} dummies</span>
            </div>
            {TRAINING_ROOMS.filter((room) => {
              const needle = query.trim().toLowerCase();
              if (!needle) return true;
              return room.name.toLowerCase().includes(needle)
                || room.description.toLowerCase().includes(needle)
                || room.placements.some((p) => trainingDummy(p.dummyId)?.name.toLowerCase().includes(needle));
            }).map((room, index) => {
              const featured = trainingDummy(room.featuredDummyId);
              return (
                <button
                  key={room.id}
                  type="button"
                  className="training-row"
                  style={{ animationDelay: `${index * 55}ms` }}
                  disabled={busy || occupied}
                  onClick={() => {
                    onEnterTraining(room.id);
                    onClose();
                  }}
                >
                  <div className="training-row-icon">
                    {featured?.itemId ? (
                      <TrainingItemIcon itemId={featured.itemId} size={40} />
                    ) : (
                      <TrainingItemIcon itemId={28558} size={40} />
                    )}
                  </div>
                  <div className="training-row-body">
                    <strong>{room.name}</strong>
                    <span>{room.description}</span>
                    <small>
                      <span className="training-meta-pill">{room.placements.length} dummies</span>
                      <span className="training-meta-pill skill">{character.dummySkill}</span>
                    </small>
                  </div>
                  <span className="training-enter">Entrar →</span>
                </button>
              );
            })}
          </div>
        ) : bossMode ? (
          <div className="boss-browser">
            <div className="hunt-list-head">
              <strong>{BOSS_TAB_LABELS[tab as BossView['category']]}</strong>
              <span>{visibleBosses.length} encounters</span>
            </div>

            {visibleBosses.length === 0 && (
              <p className="lede">{bosses.length === 0 ? 'Carregando bosses…' : 'Nenhum boss encontrado.'}</p>
            )}

            {visibleBosses.map((boss) => (
              <BossRow
                key={boss.id}
                boss={boss}
                character={character}
                currentId={currentId}
                occupied={occupied}
                busy={busy}
                onStart={onStart}
              />
            ))}
          </div>
        ) : (
          <div className={`hunt-browser${searching ? ' hunt-browser-search' : ''}`}>
            {!searching && (
              <aside className="hunt-nav">
                <button
                  type="button"
                  className={`hunt-nav-all ${showAll && !location ? 'on' : ''}`}
                  onClick={clearFilters}
                >
                  Todas
                  <span>{hunts.length}</span>
                </button>

                <div className="hunt-region-tabs">
                  {regions.map((region) => (
                    <button
                      key={region.name}
                      type="button"
                      className={`hunt-region-tab ${activeRegion === region.name && !location && !showAll ? 'on' : ''}`}
                      onClick={() => pickRegion(region.name)}
                    >
                      {region.name}
                      <span>{region.count}</span>
                    </button>
                  ))}
                </div>

                <div className="hunt-location-list">
                  {activeLocations.map((entry) => (
                    <button
                      key={entry.location}
                      type="button"
                      className={`hunt-location-btn ${location === entry.location ? 'on' : ''}`}
                      onClick={() => pickLocation(entry.location)}
                    >
                      <span>{entry.location}</span>
                      <small>{entry.count} · lvl {entry.minLevel}+</small>
                    </button>
                  ))}
                </div>
              </aside>
            )}

            <div className="hunt-list">
              {!searching && (
                <div className="hunt-list-head">
                  <strong>
                    {location
                      ? location
                      : showAll
                        ? 'Todas as hunts'
                        : regionName ?? 'Hunts'}
                  </strong>
                  <span>{visibleHunts.length} hunts</span>
                </div>
              )}

              {visibleHunts.length === 0 && (
                <p className="lede">{hunts.length === 0 ? t('loadingHunts') : t('noHuntMatch')}</p>
              )}

              {visibleHunts.map((hunt) => (
                <HuntRow
                  key={hunt.id}
                  hunt={hunt}
                  onDetail={() => setDetailHunt(hunt)}
                  hours={hours}
                  character={character}
                  currentId={currentId}
                  occupied={occupied}
                  busy={busy}
                  t={t}
                  onStart={onStart}
                />
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
    {detailHunt && <HuntDetailsModal hunt={detailHunt} onClose={() => setDetailHunt(null)} />}
    </>
  );
}

function BossRow({
  boss,
  character,
  currentId,
  occupied,
  busy,
  onStart,
}: {
  boss: BossView;
  character: CharacterView;
  currentId: string | null;
  occupied: boolean;
  busy: boolean;
  onStart: (id: string, hours: number) => void;
}) {
  const here = boss.huntId === currentId;
  const locked = !boss.unlocked;
  const cooling = boss.onCooldown;
  const cooldownLabel = formatCooldownMs(boss.cooldownRemainingMs);

  return (
    <button
      type="button"
      className={`hunt-row boss-row ${here ? 'on' : ''}${locked ? ' locked' : ''}${cooling ? ' cooldown' : ''}`}
      disabled={busy || locked || here || cooling}
      onClick={() => onStart(boss.huntId, 1)}
    >
      <div className="hunt-row-main">
        <CreatureIcon
          monsterId={boss.monsterId}
          size={64}
          label={boss.name}
          className="hunt-row-icon-main boss-row-icon"
        />

        <div className="hunt-row-body">
          <div className="hunt-row-title">
            {boss.name}
            {cooling && <span className="hunt-badge cooldown">CD {cooldownLabel}</span>}
          </div>
          <div className="meta hunt-row-meta">
            {boss.location} · lvl {boss.minLevel}+
            {locked ? ' · bloqueado' : ''}
            {here ? ' · lutando agora' : ''}
          </div>
          <p className="boss-row-desc">{boss.description}</p>
        </div>
      </div>

      <div className="hunt-row-stats">
        <b>{formatNumber(boss.experience)} XP</b>
        <div className="meta">{formatNumber(boss.health)} HP</div>
        {!cooling && !locked && !here && (
          <div className="meta profit">1 kill · 20h CD</div>
        )}
      </div>
    </button>
  );
}

function HuntRow({
  hunt,
  onDetail,
  hours,
  character,
  currentId,
  occupied,
  busy,
  t,
  onStart,
}: {
  hunt: HuntView;
  onDetail: () => void;
  hours: number;
  character: CharacterView;
  currentId: string | null;
  occupied: boolean;
  busy: boolean;
  t: (key: MessageKey) => string;
  onStart: (id: string, hours: number) => void;
}) {
  const idealSupply = Math.round((hunt.supplyCost || 0) * hours);
  const packedSupply = character.canAffordTrip === false
    ? idealSupply
    : Math.min(idealSupply, Math.round((character.affordableTripCost ?? idealSupply) * Math.min(hours, 1)));
  const loot = Math.round((hunt.expectedLootPerHour || 0) * hours);
  const here = hunt.id === currentId;
  const broke = !occupied && character.canAffordTrip === false;
  const partial = !broke && packedSupply < idealSupply;
  const locked = !hunt.unlocked || hunt.partyLocked;
  const featured = hunt.monsters[0];
  const extraMonsters = hunt.monsters.slice(1, 4);

  return (
    <div className="hunt-row-entry">
    <button
      type="button"
      data-tutorial="hunt-option"
      data-tutorial-level={hunt.recommendedLevel ?? hunt.statedLevel ?? 0}
      className={`hunt-row ${here ? 'on' : ''}${locked ? ' locked' : ''}`}
      disabled={busy || locked || here || broke}
      onClick={() => onStart(hunt.id, hours)}
    >
      <div className="hunt-row-main">
        <div className="hunt-row-icons">
          {featured && (
            <CreatureIcon monsterId={featured} size={52} label={featured} className="hunt-row-icon-main" />
          )}
          {extraMonsters.length > 0 && (
            <div className="hunt-row-icon-stack">
              {extraMonsters.map((monsterId) => (
                <CreatureIcon key={monsterId} monsterId={monsterId} size={24} label={monsterId} />
              ))}
            </div>
          )}
        </div>

        <div className="hunt-row-body">
          <div className="hunt-row-title">
            {hunt.name}
            {hunt.recommended ? <span className="hunt-badge">{t('bestForYou')}</span> : null}
            {hunt.premium ? <span className="hunt-badge premium">Premium</span> : null}
          </div>
          <div className="meta hunt-row-meta">
            {hunt.location || 'Tibia'} · lvl {hunt.recommendedLevel ?? hunt.statedLevel}
            {partyTag(hunt.partySizes, t)}
            {hunt.unlocked ? '' : ` · ${t('blocked')}`}
            {hunt.partyLocked ? ` · ${t('partyNeed')}` : ''}
            {here ? ` · ${t('huntingHere')}` : broke ? ` · ${t('packWhatYouCan')}` : partial
              ? ` · ${t('supplies')} ~${formatNumber(packedSupply)}g`
              : ` · ${t('supplies')} ${formatNumber(idealSupply)}g`}
            {hunt.slots ? ` · ${t('slots')} ${hunt.slots.used}/${hunt.slots.cap}` : ''}
            {hunt.slots?.queued ? ` · ${hunt.slots.queued} ${t('queued')}` : ''}
          </div>
          {hunt.monsters.length > 0 && (
            <div className="meta hunt-row-creatures">{hunt.monsters.join(', ')}</div>
          )}
        </div>
      </div>

      <div className="hunt-row-stats">
        <b>{formatRate(hunt.expectedXpPerHour)} XP/h</b>
        <div className={`meta ${loot - packedSupply >= 0 ? 'profit' : 'loss'}`}>
          {loot - packedSupply >= 0 ? '+' : ''}{formatRate(loot - packedSupply)} / {hours}h
        </div>
      </div>
    </button>
    <button type="button" className="btn gold hunt-detail-button" aria-label={`Detalhe de ${hunt.name}`} onClick={onDetail}>Detalhe</button>
    </div>
  );
}

function partyTag(sizes: Array<'solo' | 'duo' | 'party4'> | undefined, t: (key: MessageKey) => string): string {
  if (!sizes || sizes.includes('solo') || sizes.length === 0) return '';
  const labels = sizes.map((size) => (size === 'duo' ? t('partyDuo') : t('party4')));
  return ` · ${labels.join(' / ')}`;
}
