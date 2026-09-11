import { useEffect, useRef } from 'react';
import { monstersById, type CombatType } from '@tibia-idle/data';
import type { HuntView } from '../api/types.js';
import { CreatureIcon } from './CreatureIcon.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

const elements: Array<[CombatType, string]> = [
  ['COMBAT_PHYSICALDAMAGE', 'Físico'], ['COMBAT_ENERGYDAMAGE', 'Energia'],
  ['COMBAT_EARTHDAMAGE', 'Terra'], ['COMBAT_FIREDAMAGE', 'Fogo'],
  ['COMBAT_ICEDAMAGE', 'Gelo'], ['COMBAT_HOLYDAMAGE', 'Sagrado'],
  ['COMBAT_DEATHDAMAGE', 'Morte'], ['COMBAT_LIFEDRAIN', 'Dreno de vida'],
  ['COMBAT_MANADRAIN', 'Dreno de mana'], ['COMBAT_DROWNDAMAGE', 'Afogamento'],
];
const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function HuntDetailsModal({ hunt, onClose }: { hunt: HuntView; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div className="modal hunt-details-overlay" onClick={onClose}>
      <div ref={dialog} className="modal-card wide hunt-details" role="dialog" aria-modal="true"
        aria-labelledby="hunt-details-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
            if (!controls?.length) { event.preventDefault(); return; }
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <WindowHead title="Detalhe da hunt" onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">
          <h2 id="hunt-details-title">{hunt.name}</h2>
          <p className="hunt-details-summary">{hunt.location || 'Tibia'} · Nível {hunt.recommendedLevel ?? hunt.statedLevel} · {hunt.monsters.length} monstros</p>
          <p className="hunt-details-summary">Resistências: valores positivos reduzem o dano; negativos indicam fraqueza. Drops e XP base, sem bônus.</p>
          <div className="hunt-monster-grid">
            {hunt.monsters.map((id) => {
              const monster = monstersById.get(id);
              if (!monster) return <article className="hunt-monster-card" key={id}><h3>{id}</h3><p>Dados indisponíveis.</p></article>;
              return (
                <article className="hunt-monster-card" key={id}>
                  <div className="hunt-monster-portrait"><CreatureIcon monsterId={id} size={80} label={monster.name} /></div>
                  <h3>{monster.name}</h3>
                  <dl className="hunt-monster-stats">
                    {([['HP', monster.health], ['Experiência', monster.experience], ['Velocidade', monster.speed], ['Armadura', monster.armor], ['Defesa', monster.defense], ['Mitigação', `${number(monster.mitigation)}%`]] as const).map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? number(value) : value}</dd></div>
                    ))}
                  </dl>
                  <h4>Resistências</h4>
                  <div className="hunt-resistances">
                    {elements.map(([type, label]) => {
                      const resistance = monster.elements[type] ?? 0;
                      return <div className="hunt-resistance" key={type}>
                        <span>{label}</span><span className={`hunt-resistance-track ${resistance < 0 ? 'weak' : ''}`}>
                          <span style={{ width: `${Math.min(100, Math.abs(resistance))}%` }} />
                        </span><strong>{resistance > 0 ? '+' : ''}{number(resistance)}%</strong>
                      </div>;
                    })}
                  </div>
                  <h4>Drops <span>({monster.loot.length})</span></h4>
                  {monster.loot.length === 0 ? <p className="hunt-details-summary">Sem drops cadastrados.</p> : (
                    <ul className="hunt-monster-loot">
                      {[...monster.loot].sort((a, b) => b.chance - a.chance).map((drop, index) => (
                        <li key={`${drop.itemId}-${index}`}>
                          <ItemSlot itemId={drop.itemId} label={drop.itemName} compact showInfo={false} />
                          <div><span>{drop.itemName}</span><small>{drop.maxCount > 1 ? `1–${drop.maxCount}` : '1'} un. · {number(drop.chance / 1000)}%</small></div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        <footer className="hunt-details-footer"><button type="button" className="btn gold" onClick={onClose}>Fechar</button></footer>
      </div>
    </div>
  );
}
