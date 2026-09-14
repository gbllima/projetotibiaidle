import { useEffect, useRef } from 'react';
import type { Settlement } from '../api/types.js';
import { formatDuration, formatNumber } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { WindowHead } from './WindowHead.js';
import './AwayModal.css';

export function AwayModal({ away, onClose }: { away: Settlement; onClose: () => void }) {
  const { t, locale } = useLocale();
  const pt = locale === 'pt';
  const training = away.training;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const skillNames: Record<string, string> = pt
    ? { sword: 'Espada', axe: 'Machado', club: 'Clava', distance: 'Distância', fist: 'Punho', shield: 'Escudo', fishing: 'Pesca', magic: 'Nível mágico' }
    : { sword: 'Sword', axe: 'Axe', club: 'Club', distance: 'Distance', fist: 'Fist', shield: 'Shielding', fishing: 'Fishing', magic: 'Magic Level' };
  const stopped = away.stoppedBecause;
  const status = stopped === 'died' ? t('endedDied')
    : stopped === 'fled' ? t('endedFled')
      : stopped === 'out_of_supplies' ? (pt ? 'A caçada terminou por falta de suprimentos.' : 'The hunt ended because supplies ran out.')
        : stopped === 'no_stamina' ? t('endedStamina')
          : stopped ? t('huntEnded') : (pt ? 'A caçada continuou durante sua ausência.' : 'Your hunt continued while you were away.');

  return <div className="modal" onClick={onClose}>
    <div className="modal-card away" role="dialog" aria-modal="true" aria-label={t('awayTitle')}
      ref={dialog} tabIndex={-1} onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key !== 'Tab') return;
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}>
      <WindowHead title={t('awayTitle')} onClose={onClose} closeLabel={t('close')} />
      <div className="modal-card-body">
        <p className="lede modal-lede-left">{training
          ? (pt ? 'Seu personagem continuou treinando enquanto você estava offline.' : 'Your character kept training while you were offline.')
          : status}</p>
        <div className="away-grid">
          <div><span>{pt ? 'Tempo ausente' : 'Time away'}</span><strong>{formatDuration(away.elapsedSeconds + (away.discardedSeconds ?? 0))}</strong></div>
          <div><span>{pt ? 'Tempo contabilizado' : 'Time credited'}</span><strong>{formatDuration(away.elapsedSeconds)}</strong></div>
        </div>
        {training ? <>
          <div className="away-grid">
            <div><span>{pt ? 'Skill treinada' : 'Trained skill'}</span><strong>{skillNames[training.skill] ?? training.skill}</strong></div>
            <div><span>{pt ? 'Evolução da skill' : 'Skill levels'}</span><strong>{training.beforeLevel} → {training.afterLevel}</strong></div>
            <div><span>{training.skill === 'magic' ? (pt ? 'Mana treinada' : 'Mana trained') : (pt ? 'Pontos de treino' : 'Training points')}</span><strong>+{formatNumber(training.gained)}</strong></div>
            <div><span>{pt ? 'Cargas utilizadas' : 'Charges used'}</span><strong>{formatNumber(training.chargesUsed)}</strong></div>
            <div><span>{pt ? 'Stamina recuperada' : 'Stamina recovered'}</span><strong>+{training.stamina} min</strong></div>
          </div>
          {training.beforePercent !== undefined && training.afterPercent !== undefined && <div className="away-progress">
            {[
              { label: pt ? 'Antes' : 'Before', level: training.beforeLevel, percent: training.beforePercent },
              { label: pt ? 'Depois' : 'After', level: training.afterLevel, percent: training.afterPercent },
            ].map(({ label, level, percent }) => <div key={label}>
              <div className="away-progress-label"><span>{label} · {pt ? 'nível' : 'level'} {level}</span><strong>{percent.toLocaleString(pt ? 'pt-BR' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></div>
              <div className="away-progress-track" role="progressbar" aria-label={`${label} · ${skillNames[training.skill] ?? training.skill} · ${pt ? 'nível' : 'level'} ${level}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <i style={{ width: `${percent}%` }} />
              </div>
            </div>)}
          </div>}
          {training.chargesExhausted && <p className="away-notice">{pt
            ? 'Suas cargas acabaram durante o treino. O tempo restante foi aproveitado no treino gratuito.'
            : 'Your charges ran out during training. Any remaining time was used for free training.'}</p>}
        </> : <div className="away-grid">
          <div><span>{t('awayXp')}</span><strong>{formatNumber(away.delta?.experience ?? 0)}</strong></div>
          <div><span>{t('awayKills')}</span><strong>{formatNumber(away.delta?.kills ?? 0)}</strong></div>
          <div><span>{t('awayLoot')}</span><strong>{formatNumber(away.delta?.lootValue ?? 0)}</strong></div>
          <div><span>{t('awaySupplies')}</span><strong>{formatNumber(away.delta?.supplyValue ?? 0)}</strong></div>
          <div><span>{t('awayLevels')}</span><strong>{away.delta?.levels ?? 0}</strong></div>
          <div><span>{t('awayEfficiency')}</span><strong>{Math.round((away.efficiency ?? 1) * 100)}%</strong></div>
        </div>}
        {!!away.discardedSeconds && <p className="away-notice">{pt
          ? `Limite offline de ${away.capHours ?? 8}h atingido. ${formatDuration(away.discardedSeconds)} não foram contabilizadas.`
          : `${away.capHours ?? 8}h offline limit reached. ${formatDuration(away.discardedSeconds)} was not credited.`}</p>}
        <button className="btn gold away-confirm" onClick={onClose}>{t('gotIt')}</button>
      </div>
    </div>
  </div>;
}
