import { useEffect, useState } from 'react';
import { vocationsById } from '@tibia-idle/data';
import { partySlotPrices } from '@tibia-idle/sim';
import { api, type MultiplayerPartyStatus, type SocialInbox } from '../api/client.js';
import type { CharacterView } from '../api/types.js';
import { xpProgress } from '../format.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { DockBox } from './DockBox.js';
import { ItemSlot } from './ItemSlot.js';
import { OutfitModal, type OutfitDraft } from './OutfitModal.js';
import { PartyItemsModal } from './PartyItemsModal.js';
import './SocialInviteToast.css';

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

type LivePartyMember = CharacterView['caveParty'][number] & { multiplayer?: boolean };

function BackpackIcon() {
  return <svg className="party-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 6V4.8C6.5 3.25 7.75 2 9.3 2h1.4c1.55 0 2.8 1.25 2.8 2.8V6M5 6.2h10c1.1 0 2 .9 2 2V16c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V8.2c0-1.1.9-2 2-2Zm2.5 0v2m5-2v2M6 12h8m-4-2v5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function HoodIcon() {
  return <svg className="party-action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2c-3.1 0-5.5 3-5.5 6.7 0 1.7.45 3.3 1.25 4.55L4.7 17.8h10.6l-1.05-4.35A8.7 8.7 0 0 0 15.5 8.9c0-3.7-2.4-6.7-5.5-6.7Zm-2.7 7.1c.55-1.25 1.5-2.05 2.7-2.05s2.15.8 2.7 2.05c-.35 2-1.35 3.25-2.7 3.25S7.65 11.3 7.3 9.3Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function draftFrom(character: CharacterView): OutfitDraft {
  const a = character.appearance;
  return { outfit:a.outfit, head:a.head, body:a.body, legs:a.legs, feet:a.feet, addons:a.addons ?? 0, mount:a.mount ?? 0, aura:a.aura ?? 0 };
}

export function PartyPanel({ character, busy, onConfig, onToggle, onUnlock, onBlessings }: Props) {
  const [itemsTarget, setItemsTarget] = useState<CharacterView | null>(null);
  const [appearanceTarget, setAppearanceTarget] = useState<CharacterView | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [multiplayer, setMultiplayer] = useState<MultiplayerPartyStatus | null>(null);
  const [socialInbox, setSocialInbox] = useState<SocialInbox>({ friendRequests: [] });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    let live = true;
    let running = false;
    const refresh = () => {
      if (running) return;
      running = true;
      void Promise.all([
        api.multiplayerParty(character.id),
        api.socialInbox(character.id),
      ]).then(([party, inbox]) => {
        if (!live) return;
        setMultiplayer(party);
        setSocialInbox(inbox);
      }).catch(() => undefined).finally(() => { running = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [character.id]);

  const respondToParty = async (accept: boolean) => {
    if (inviteBusy) return;
    setInviteBusy(true); setInviteError('');
    try {
      const result = accept
        ? await api.acceptMultiplayerParty(character.id)
        : await api.declineMultiplayerParty(character.id);
      setMultiplayer(result.status);
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : 'Não foi possível responder ao convite.');
    } finally {
      setInviteBusy(false);
    }
  };

  const respondToFriend = async (fromId: number, accept: boolean) => {
    if (inviteBusy) return;
    setInviteBusy(true); setInviteError('');
    try {
      const result = accept
        ? await api.acceptFriendRequest(character.id, fromId)
        : await api.declineFriendRequest(character.id, fromId);
      setSocialInbox(result.inbox);
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : 'Não foi possível responder ao pedido de amizade.');
    } finally {
      setInviteBusy(false);
    }
  };

  const ids = character.partyMemberIds ?? [character.id];
  const self = { ...character, vocationId: character.vocation.id, self: true, active: character.session?.status === 'active' };
  const caveParty = (character.caveParty ?? []) as LivePartyMember[];
  const multiplayerMembers = caveParty.filter((member) => member.multiplayer && !member.self);
  const members = multiplayerMembers.length > 0
    ? [self, ...multiplayerMembers]
    : ids.map((id) => id === character.id ? self : caveParty.find((member) => member.id === id)).filter((member) => member !== undefined);
  const prices = partySlotPrices(character.partySlots);

  const openMemberMenu = async (id: number, kind: 'items' | 'appearance') => {
    if (menuBusy) return;
    setMenuBusy(true); setMenuError('');
    try {
      if (kind === 'items') {
        const result = await api.partyItemsView(character.id, id);
        setItemsTarget(result.character);
      } else {
        const result = await api.character(id);
        setAppearanceTarget(result.character);
      }
    } catch (reason) {
      setMenuError(reason instanceof Error ? reason.message : 'Não foi possível abrir o menu do personagem.');
    } finally { setMenuBusy(false); }
  };

  const refreshAppearanceTarget = async (id: number) => { const result = await api.character(id); setAppearanceTarget(result.character); return result.character; };
  const incomingParty = !multiplayer?.active ? multiplayer?.invite : undefined;

  return <>
    {(incomingParty || socialInbox.friendRequests.length > 0) && <div className="social-invite-stack" aria-live="polite">
      {incomingParty && <article className="social-invite-toast party">
        <span className="social-invite-mark" aria-hidden>⚔</span>
        <div className="social-invite-copy"><small>Convite para party</small><strong>{incomingParty.fromName}</strong><p>Quer formar uma Party Multiplayer com você.</p></div>
        <div className="social-invite-actions"><button type="button" disabled={inviteBusy} onClick={() => void respondToParty(false)}>Recusar</button><button className="accept" type="button" disabled={inviteBusy} onClick={() => void respondToParty(true)}>Aceitar</button></div>
        {inviteError && <p className="social-invite-error">{inviteError}</p>}
      </article>}
      {socialInbox.friendRequests.slice(0, 2).map((request) => <article className="social-invite-toast friend" key={request.fromId}>
        <span className="social-invite-mark" aria-hidden>★</span>
        <div className="social-invite-copy"><small>Pedido de amizade</small><strong>{request.fromName}</strong><p>Level {request.level} quer adicionar você como amigo.</p></div>
        <div className="social-invite-actions"><button type="button" disabled={inviteBusy} onClick={() => void respondToFriend(request.fromId, false)}>Recusar</button><button className="accept" type="button" disabled={inviteBusy} onClick={() => void respondToFriend(request.fromId, true)}>Aceitar</button></div>
        {inviteError && <p className="social-invite-error">{inviteError}</p>}
      </article>)}
    </div>}

    <DockBox id="party-config" title="Party" bodyClass="body party-panel" extra={<>
      <button type="button" className="party-head-button" onClick={onBlessings} title="Bênçãos" aria-label="Abrir bênçãos">☠</button>
      <button type="button" className="party-head-button party-config-button" onClick={onConfig}>Config</button>
    </>}>
      {menuError && <div className="party-inline-error" role="alert">{menuError}</div>}
      {members.map((member) => {
        const liveMember = member as LivePartyMember;
        const remoteMultiplayer = Boolean(liveMember.multiplayer && member.id !== character.id);
        const xp = xpProgress(member.level, member.experience ?? 0).percent;
        const rawHealth = member.health ?? 0, maxHealth = member.maxHealth ?? 1;
        const rawMana = member.mana ?? 0, maxMana = member.maxMana ?? 1;
        // During a configured party hunt every member is started together. If a
        // companion stops being active while the principal is still fighting,
        // that member has left combat because they died. Keep the visual death
        // state even though the server has already restored their city vitals.
        const principalStillHunting = character.session?.status === 'active';
        const isDead = rawHealth <= 0
          || (principalStillHunting && member.id !== character.id && !member.active)
          || (member.id === character.id && character.session?.status === 'died');
        // Party companions can retain a stale/predicted hunt snapshot for a short
        // time after the leader returns to the city. Their activity flag is the
        // authoritative UI signal: while inactive/out of hunt, show stable city
        // vitals instead of rendering those obsolete combat values as if they
        // were still taking damage or spending mana. Dead members are the one
        // exception: while the party keeps fighting, their combat HUD stays at 0.
        const inPartyCombat = Boolean(member.active);
        const health = isDead ? 0 : member.id === character.id || inPartyCombat ? rawHealth : maxHealth;
        const mana = isDead ? 0 : member.id === character.id || inPartyCombat ? rawMana : maxMana;
        const vocation = vocationsById.get(member.vocationId);
        const role = [2,6].includes(member.vocationId) ? 'SUP' : [4,8].includes(member.vocationId) ? 'TANK' : 'DPS';
        return <article className={'party-compact-member' + (member.id === character.id ? ' primary' : '') + (isDead ? ' dead' : '')} key={member.id} aria-label={isDead ? member.name+' — morto' : undefined}>
          <div className="party-compact-top"><div className="party-compact-details">
            <div className="party-compact-name"><span className={'party-role '+role.toLowerCase()}>{role}</span><strong title={member.name}>{member.name}</strong>{isDead && <span className="party-dead-label">☠ MORTO</span>}</div>
            <div className="party-compact-vocation">{vocation?.name ?? 'Aventureiro'} · lvl {member.level}{remoteMultiplayer ? ' · MULTIPLAYER' : ''}</div>
            <div className="party-compact-bars" data-tutorial={member.id === character.id ? 'party-vitals' : undefined}>{([{kind:'hp',icon:'♥',label:'Vida',value:health,max:maxHealth},{kind:'mana',icon:'♦',label:'Mana',value:mana,max:maxMana},{kind:'xp',icon:'XP',label:'Experiência',value:xp,max:100}] as const).map((bar)=><div className={'party-compact-bar '+bar.kind} key={bar.kind}><span aria-hidden>{bar.icon}</span><div role="progressbar" aria-label={bar.label+' de '+member.name} aria-valuemin={0} aria-valuemax={bar.max} aria-valuenow={Math.min(bar.max,Math.max(0,bar.value))}><i style={{width:Math.min(100,Math.max(0,bar.value/Math.max(1,bar.max)*100))+'%'}}/><b>{bar.kind==='xp'?Math.round(xp)+'%':Math.round(bar.value)+'/'+bar.max}</b></div></div>)}</div>
          </div>{!remoteMultiplayer && <div className="party-mini-set" aria-label={'Equipamento de '+member.name}>{PAPERDOLL_SLOTS.map((slot)=><div className={'paper-slot '+slot.area} key={slot.id}><ItemSlot itemId={member.equipment?.[slot.id]?.id} compact emptyLabel={slot.id==='ring'?'Anel':slot.id==='necklace'?'Amuleto':slot.id==='ammo'?'Berloque':undefined} onClick={()=>void openMemberMenu(member.id,'items')}/></div>)}</div>}</div>
          {!remoteMultiplayer && <div className="party-compact-actions"><button type="button" disabled={busy||menuBusy} onClick={()=>void openMemberMenu(member.id,'items')}><BackpackIcon /> Itens</button><button type="button" disabled={busy||menuBusy} onClick={()=>void openMemberMenu(member.id,'appearance')}><HoodIcon /> Aparência</button></div>}
          {remoteMultiplayer
            ? <div className={'party-activity '+(member.active?'active':'')}><i />{member.active?'Na mesma hunt · status sincronizado':'Na party multiplayer · aguardando hunt'}</div>
            : <button type="button" className={'party-activity '+(member.active?'active':'')} disabled={busy||(member.id!==character.id&&!member.active&&character.session?.status!=='active')} title={member.active?'Parar a caçada deste personagem':'Entrar na caçada do principal'} onClick={()=>onToggle(member.id,!!member.active)}><i />{member.active?'Ativo · recebendo XP da party':'Inativo · sem XP da party'}</button>}
        </article>;
      })}
      {multiplayerMembers.length === 0 && members.length < character.partySlots && <button type="button" className="party-empty-member" onClick={onConfig}>＋ Adicionar personagem à formação</button>}
      {multiplayerMembers.length === 0 && character.partySlots < 3 && <div className="party-locked-member"><div><span aria-hidden>⚔</span> SLOT BLOQUEADO</div><button type="button" disabled={busy||character.gold<prices.gold} onClick={()=>onUnlock('gold')}>Desbloquear por Gold — {prices.gold.toLocaleString('pt-BR')}</button></div>}
    </DockBox>

    {itemsTarget && <PartyItemsModal character={itemsTarget} controllerCharacterId={character.id} busy={menuBusy} onClose={()=>setItemsTarget(null)} />}

    {appearanceTarget && <OutfitModal key={`party-outfit-${appearanceTarget.id}-${appearanceTarget.appearance.outfit}`} character={appearanceTarget} busy={menuBusy} onClose={()=>setAppearanceTarget(null)}
      onApply={async(draft)=>{setMenuBusy(true);setMenuError('');try{const result=await api.act(appearanceTarget.id,{type:'appearance',...draft});setAppearanceTarget(result.character);}finally{setMenuBusy(false);}}}
      onPresetSave={async(slot)=>{setMenuBusy(true);try{await api.act(appearanceTarget.id,{type:'preset-save',slot});await refreshAppearanceTarget(appearanceTarget.id);}finally{setMenuBusy(false);}}}
      onPresetLoad={async(slot)=>{setMenuBusy(true);try{const result=await api.act(appearanceTarget.id,{type:'preset-load',slot});setAppearanceTarget(result.character);return draftFrom(result.character);}finally{setMenuBusy(false);}}}/>} 
  </>;
}