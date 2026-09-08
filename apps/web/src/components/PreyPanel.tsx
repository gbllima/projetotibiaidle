import { useMemo, useState } from 'react';
import { monstersById } from '@tibia-idle/data';
import {
  PREY_DURATION_MS,
  PREY_WILDCARD_AUTO_BONUS,
  PREY_WILDCARD_LOCK,
  PREY_WILDCARD_PICK,
  isPreyActive,
  preyBonusPercent,
  preyListRerollGold,
  preyPool,
  preySlotCount,
  PREY_BONUS_LABELS,
  type PreyBonus,
} from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { CreatureIcon } from './CreatureIcon.js';
import { formatNumber } from '../format.js';
import { uiUrl } from '../ui/chrome.js';

const BONUS_ICON: Record<PreyBonus, string> = {
  damage: 'game/prey/prey_bigdamage',
  defense: 'game/prey/prey_bigdefense',
  experience: 'game/prey/prey_bigxp',
  loot: 'game/prey/prey_bigloot',
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PreyStars({ star }: { star: number }) {
  const filled = Math.min(10, Math.max(0, star + 1));
  return (
    <div className="prey-stars" aria-label={`${filled} estrelas`}>
      {Array.from({ length: 10 }, (_, i) => (
        <img
          key={i}
          src={uiUrl(i < filled ? 'game/prey/prey_star' : 'game/prey/prey_nostar')}
          alt=""
          width={9}
          height={10}
        />
      ))}
    </div>
  );
}

function PreySlotCard({
  index,
  slot,
  character,
  busy,
  onAct,
}: {
  index: number;
  slot: CharacterView['prey'][number];
  character: CharacterView;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const now = Date.now();
  const active = isPreyActive({ ...slot, bonus: slot.bonus as PreyBonus }, now);
  const monster = slot.monsterId ? monstersById.get(slot.monsterId) : null;
  const bonus = slot.bonus as PreyBonus;
  const percent = preyBonusPercent(bonus, slot.star);
  const listFree = slot.listRerollAt <= now;
  const listCost = preyListRerollGold(character.level);
  const wildcards = character.preyWildcards ?? character.preyRerolls ?? 0;
  const [wildcardOpen, setWildcardOpen] = useState(false);
  const [wildcardQuery, setWildcardQuery] = useState('');

  const poolChoices = useMemo(() => {
    const used = character.prey
      .map((entry, i) => (i === index ? null : entry.monsterId))
      .filter(Boolean) as string[];
    return preyPool({
      level: character.level,
      bestiary: character.bestiary,
    } as Parameters<typeof preyPool>[0])
      .filter((id) => !used.includes(id))
      .map((id) => ({ id, name: monstersById.get(id)?.name ?? id }))
      .filter((entry) => !wildcardQuery || entry.name.toLowerCase().includes(wildcardQuery.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [character, index, wildcardQuery]);

  const act = async (body: Record<string, unknown>) => {
    try {
      await onAct(body);
    } catch {
      /* GameScreen surfaces errors */
    }
  };

  return (
    <article className={`prey-slot${active ? ' active' : ''}${index >= 3 ? ' premium' : ''}`}>
      <header className="prey-slot-head">
        <span>Prey Slot {index + 1}</span>
        {index >= 3 && <em className="prey-vip-tag">VIP</em>}
      </header>

      {active && monster ? (
        <div className="prey-active">
          <div className="prey-active-main">
            <div className="prey-creature-frame">
              <CreatureIcon monsterId={slot.monsterId!} size={72} label={monster.name} />
            </div>
            <div className="prey-bonus-panel">
              <img className="prey-bonus-icon" src={uiUrl(BONUS_ICON[bonus])} alt="" />
              <hr />
              <PreyStars star={slot.star} />
              <p className="prey-bonus-text">{PREY_BONUS_LABELS[bonus]}</p>
              <strong className="prey-bonus-pct">+{percent}%</strong>
            </div>
          </div>
          <p className="prey-timer">
            Tempo restante: <b>{formatDuration(slot.expiresAt - now)}</b>
            <span className="meta"> · dura {formatDuration(PREY_DURATION_MS)} por ativação</span>
          </p>
          <div className="prey-active-actions">
            <button
              className="btn prey-wildcard-btn"
              disabled={busy || wildcards < PREY_WILDCARD_AUTO_BONUS}
              title={`${PREY_WILDCARD_AUTO_BONUS} Prey Wildcard`}
              onClick={() => void act({ type: 'prey-bonus-reroll', slot: index })}
            >
              <img src={uiUrl('game/prey/prey_bonus_up')} alt="" />
              Reroll bônus
            </button>
          </div>
          <div className="prey-toggles">
            <label className="prey-toggle">
              <input
                type="checkbox"
                checked={slot.autoBonusReroll}
                disabled={busy}
                onChange={() => void act({ type: 'prey-toggle-auto-bonus', slot: index })}
              />
              <span>Automatic Bonus Reroll</span>
              <small>({PREY_WILDCARD_AUTO_BONUS} wildcard / 2h)</small>
            </label>
            <label className="prey-toggle">
              <input
                type="checkbox"
                checked={slot.locked}
                disabled={busy}
                onChange={() => void act({ type: 'prey-toggle-lock', slot: index })}
              />
              <span>Lock Prey</span>
              <small>({PREY_WILDCARD_LOCK} wildcards / 2h)</small>
            </label>
          </div>
        </div>
      ) : (
        <div className="prey-select">
          <p className="prey-select-hint">Escolha uma criatura da lista (9 opções).</p>
          <div className="prey-candidate-grid">
            {(slot.candidates ?? []).map((id) => {
              const name = monstersById.get(id)?.name ?? id;
              return (
                <button
                  key={id}
                  type="button"
                  className="prey-candidate"
                  disabled={busy}
                  title={name}
                  onClick={() => void act({ type: 'prey-select', slot: index, monsterId: id })}
                >
                  <CreatureIcon monsterId={id} size={48} label={name} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
          <div className="prey-select-actions">
            <button
              className="btn prey-reroll-btn"
              disabled={busy || (!listFree && character.gold < listCost)}
              onClick={() => void act({ type: 'prey-list-reroll', slot: index })}
            >
              <img src={uiUrl('game/prey/prey_reroll_up')} alt="" />
              {listFree ? 'Reroll grátis' : `Reroll · ${formatNumber(listCost)}g`}
            </button>
            {!listFree && (
              <span className="meta prey-reroll-meta">
                Grátis em {formatDuration(slot.listRerollAt - now)}
              </span>
            )}
            <button
              className="btn prey-wildcard-btn"
              disabled={busy}
              onClick={() => setWildcardOpen((open) => !open)}
            >
              <img src={uiUrl('game/prey/prey_wildcard')} alt="" />
              Wildcard ({PREY_WILDCARD_PICK})
            </button>
          </div>
          {wildcardOpen && (
            <div className="prey-wildcard-panel">
              <input
                className="prey-wildcard-search"
                placeholder="Buscar criatura…"
                value={wildcardQuery}
                onChange={(event) => setWildcardQuery(event.target.value)}
              />
              <div className="prey-wildcard-list">
                {poolChoices.slice(0, 80).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="prey-wildcard-row"
                    disabled={busy || wildcards < PREY_WILDCARD_PICK}
                    onClick={() => void act({ type: 'prey-wildcard-pick', slot: index, monsterId: entry.id })}
                  >
                    <CreatureIcon monsterId={entry.id} size={20} label={entry.name} />
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function PreyPanel({
  character,
  busy,
  onAct,
}: {
  character: CharacterView;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const slots = character.prey.slice(0, preySlotCount({
    premium: character.premium,
    vipUntil: character.vipUntil,
  } as Parameters<typeof preySlotCount>[0]));
  const wildcards = character.preyWildcards ?? character.preyRerolls ?? 0;

  return (
    <div className="prey-panel">
      <div className="prey-toolbar">
        <p className="prey-lede">
          Bônus de dano, defesa, XP ou loot contra a criatura escolhida por <strong>2 horas</strong>.
          Lista reroll grátis a cada <strong>20 horas</strong> por slot; ou pague <strong>{preyListRerollGold(character.level)} gold</strong> (150 × level).
        </p>
        <div className="prey-wildcard-balance">
          <img src={uiUrl('game/prey/prey_wildcard')} alt="" width={20} height={18} />
          <span>Prey Wildcards: <strong>{wildcards}</strong></span>
        </div>
      </div>
      <div className="prey-slots">
        {slots.map((slot, index) => (
          <PreySlotCard key={index} index={index} slot={slot} character={character} busy={busy} onAct={onAct} />
        ))}
        {character.premium && character.vipUntil <= Date.now() && slots.length < 4 && (
          <article className="prey-slot locked-slot">
            <header className="prey-slot-head"><span>Prey Slot 4</span><em className="prey-vip-tag">VIP</em></header>
            <p className="soon">Ative VIP para desbloquear o 4º slot de Prey.</p>
          </article>
        )}
      </div>
    </div>
  );
}
