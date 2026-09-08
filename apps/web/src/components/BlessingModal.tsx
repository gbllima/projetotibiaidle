import { useMemo } from 'react';
import {
  BLESSING_CAP, BLESSING_NAMES, allMainBlessings, blessingCost, blessingCount,
  buyAllBlessingsCost, deathLossRate, hasBlessing, missingBlessingIndices,
} from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { formatNumber } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { blessingRecordIcon } from '../render/blessingIcon.js';
import { WindowHead } from './WindowHead.js';

export function BlessingModal({
  character,
  busy,
  onClose,
  onBuy,
  onBuyAll,
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onBuy: (index: number) => void;
  onBuyAll: () => void;
}) {
  const { t, locale } = useLocale();
  const mask = character.blessings ?? 0;
  const owned = blessingCount(mask);
  const unit = blessingCost(character.level);
  const missing = missingBlessingIndices(mask);
  const allCost = buyAllBlessingsCost(character.level, mask);
  const lossPct = Math.round(deathLossRate(mask) * 1000) / 10;
  const nakedPct = 10;
  const icons = useMemo(
    () => BLESSING_NAMES.map((_, index) => blessingRecordIcon(index, hasBlessing(mask, index))),
    [mask],
  );

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card blessing-window" onClick={(event) => event.stopPropagation()}>
        <WindowHead title={t('blessTitle')} onClose={onClose} closeLabel={t('close')} />
        <div className="modal-card-body">
        <section className="bless-section">
          <h3>{t('blessRecord')}</h3>
          <div className="bless-grid">
            {BLESSING_NAMES.map((blessing, index) => {
              const active = hasBlessing(mask, index);
              const name = locale === 'pt' ? blessing.pt : blessing.en;
              return (
                <div className={`bless-widget ${active ? 'active' : ''}`} key={blessing.id}>
                  <div className="bless-widget-icon">
                    <img src={icons[index]} alt="" width={64} height={64} draggable={false} />
                  </div>
                  <div className="bless-widget-count">{active ? '1 (0)' : '0 (0)'}</div>
                  <div className="bless-widget-name">{name}</div>
                  {!active ? (
                    <button
                      type="button"
                      className="btn gold bless-buy-one"
                      disabled={busy || character.gold < unit}
                      onClick={() => onBuy(index)}
                    >
                      {formatNumber(unit)}g
                    </button>
                  ) : (
                    <span className="bless-owned">✓</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="bless-section">
          <h3>{t('blessEffect')}</h3>
          <p className="lede bless-info">
            {locale === 'pt'
              ? `Você tem ${owned}/${BLESSING_CAP} bênçãos. Perda de XP/skills na morte: ${lossPct}% (sem bênçãos: ${nakedPct}%).`
              : `You have ${owned}/${BLESSING_CAP} blessings. XP/skill loss on death: ${lossPct}% (none: ${nakedPct}%).`}
          </p>
          <ul className="bless-perks">
            <li>{t('blessPerkXp')}</li>
            <li>{t('blessPerkLoot')}</li>
            <li>{t('blessPerkConsume')}</li>
          </ul>
        </section>

        <div className="bless-actions">
          <button
            type="button"
            className="btn gold"
            disabled={busy || missing.length === 0 || character.gold < allCost}
            onClick={onBuyAll}
          >
            {missing.length === 0
              ? t('blessAllOwned')
              : `${t('blessBuyAll')} · ${formatNumber(allCost)} gold (${missing.length})`}
          </button>
          <span className="meta">
            {t('blessUnitPrice')}: {formatNumber(unit)} gold · {owned}/{BLESSING_CAP}
            {allMainBlessings(mask) ? ` · ${t('blessFull')}` : ''}
          </span>
        </div>

        <button type="button" className="btn gold" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>
          {t('gotIt')}
        </button>
        </div>
      </div>
    </div>
  );
}
