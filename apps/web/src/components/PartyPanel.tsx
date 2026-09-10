import { vocationsById } from '@tibia-idle/data';
import { partySlotPrices } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { xpProgress } from '../format.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { DockBox } from './DockBox.js';
import { ItemSlot } from './ItemSlot.js';

type Props = {
  character: CharacterView;
  busy: boolean;
  onConfig: () => void;
  onItems: (id: number) => void;
  onOutfit: (id: number) => void;
  onToggle: (id: number, active: boolean) => void;
  onUnlock: (currency: 'gold' | 'coins') => void;
  onBlessings: () => void;
};

function BackpackIcon() {
  return <svg className="party-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 6V4.8C6.5 3.25 7.75 2 9.3 2h1.4c1.55 0 2.8 1.25 2.8 2.8V6M5 6.2h10c1.1 0 2 .9 2 2V16c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V8.2c0-1.1.9-2 2-2Zm2.5 0v2m5-2v2M6 12h8m-4-2v5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function HoodIcon() {
  return <svg className="party-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2c-3.1 0-5.5 3-5.5 6.7 0 1.7.45 3.3 1.25 4.55L4.7 17.8h10.6l-1.05-4.35A8.7 8.7 0 0 0 15.5 8.9c0-3.7-2.4-6.7-5.5-6.7Zm-2.7 7.1c.55-1.25 1.5-2.05 2.7-2.05s2.15.8 2.7 2.05c-.35 2-1.35 3.25-2.7 3.25S7.65 11.3 7.3 9.3Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function PartyPanel({ character, busy, onConfig, onItems, onOutfit, onToggle, onUnlock, onBlessings }: Props) {
  const ids = character.partyMemberIds ?? [character.id];
  const self = { ...character, vocationId: character.vocation.id, self: true, active: character.session?.status === 'active' };
  const members = ids.map((id) => id === character.id ? self : character.caveParty.find((member) => member.id === id)).filter((member) => member !== undefined);
  const prices = partySlotPrices(character.partySlots);
  return <DockBox id="party-config" title="Party" bodyClass="body party-panel" extra={<>
    <button type="button" className="party-head-button" onClick={onBlessings} title="Bênçãos" aria-label="Abrir bênçãos">☠</button>
    <button type="button" className="party-head-button party-config-button" onClick={onConfig}>Config</button>
  </>}>
    {members.map((member) => {
      const xp = xpProgress(member.level, member.experience ?? 0).percent;
      const health = member.health ?? 0, maxHealth = member.maxHealth ?? 1;
      const mana = member.mana ?? 0, maxMana = member.maxMana ?? 1;
      const vocation = vocationsById.get(member.vocationId);
      const role = [2, 6].includes(member.vocationId) ? 'SUP' : [4, 8].includes(member.vocationId) ? 'TANK' : 'DPS';
      return <article className={'party-compact-member' + (member.id === character.id ? ' primary' : '')} key={member.id}>
        <div className="party-compact-top">
          <div className="party-compact-details">
            <div className="party-compact-name"><span className={'party-role ' + role.toLowerCase()}>{role}</span><strong title={member.name}>{member.name}</strong></div>
            <div className="party-compact-vocation">{vocation?.name ?? 'Aventureiro'} · lvl {member.level}</div>
            <div className="party-compact-bars">
              {([{ kind: 'hp', icon: '♥', label: 'Vida', value: health, max: maxHealth }, { kind: 'mana', icon: '♦', label: 'Mana', value: mana, max: maxMana }, { kind: 'xp', icon: 'XP', label: 'Experiência', value: xp, max: 100 }] as const).map((bar) => <div className={'party-compact-bar ' + bar.kind} key={bar.kind}>
                <span aria-hidden>{bar.icon}</span><div role="progressbar" aria-label={bar.label + ' de ' + member.name} aria-valuemin={0} aria-valuemax={bar.max} aria-valuenow={Math.min(bar.max, Math.max(0, bar.value))}>
                  <i style={{ width: Math.min(100, Math.max(0, bar.value / Math.max(1, bar.max) * 100)) + '%' }} />
                  <b>{bar.kind === 'xp' ? Math.round(xp) + '%' : Math.round(bar.value) + '/' + bar.max}</b>
                </div>
              </div>)}
            </div>
          </div>
          <div className="party-mini-set" aria-label={'Equipamento de ' + member.name}>
            {PAPERDOLL_SLOTS.map((slot) => <div className={'paper-slot ' + slot.area} key={slot.id}>
              <ItemSlot itemId={member.equipment?.[slot.id]?.id} compact emptyLabel={slot.id === 'ring' ? 'Anel' : slot.id === 'necklace' ? 'Amuleto' : slot.id === 'ammo' ? 'Berloque' : undefined} onClick={() => onItems(member.id)} />
            </div>)}
          </div>
        </div>
        <div className="party-compact-actions">
          <button type="button" disabled={busy} onClick={() => onItems(member.id)}><BackpackIcon /> Itens</button>
          <button type="button" disabled={busy} onClick={() => onOutfit(member.id)}><HoodIcon /> Aparência</button>
        </div>
        <button type="button" className={'party-activity ' + (member.active ? 'active' : '')} disabled={busy || (member.id !== character.id && !member.active && character.session?.status !== 'active')}
          title={member.active ? 'Parar a caçada deste personagem' : 'Entrar na caçada do principal'} onClick={() => onToggle(member.id, !!member.active)}>
          <i />{member.active ? 'Ativo · recebendo XP da party' : 'Inativo · sem XP da party'}
        </button>
      </article>;
    })}
    {members.length < character.partySlots && <button type="button" className="party-empty-member" onClick={onConfig}>＋ Adicionar personagem à formação</button>}
    {character.partySlots < 3 && <div className="party-locked-member">
      <div><span aria-hidden>⚔</span> SLOT BLOQUEADO</div>
      <button type="button" disabled={busy || character.gold < prices.gold} onClick={() => onUnlock('gold')}>Desbloquear por gold — {prices.gold.toLocaleString('pt-BR')}</button>
      <button type="button" disabled={busy || character.coins < prices.coins} onClick={() => onUnlock('coins')}>Desbloquear na Store — {prices.coins} coins</button>
    </div>}
  </DockBox>;
}
