import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PLAYABLE_VOCATION_IDS, vocationsById } from '@tibia-idle/data';
import { api, type MultiplayerPartyStatus } from '../api/client.js';
import type { CharacterView } from '../api/types.js';
import { PartyPortrait } from './PartyPortrait.js';

export function PartyManagerModal({ character, onClose, onSaved }: { character: CharacterView; onClose: () => void; onSaved: (next: CharacterView) => void }) {
  const initial = character.partyMemberIds ?? [character.id];
  const [formation, setFormation] = useState(() => [character.id, ...initial.filter((id) => id !== character.id)]);
  const [roster, setRoster] = useState<CharacterView[]>([character]);
  const [tab, setTab] = useState<'single' | 'multi'>('single');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [vocationId, setVocationId] = useState(4);
  const [canCreate, setCanCreate] = useState(false);
  const [multiplayer, setMultiplayer] = useState<MultiplayerPartyStatus | null>(null);
  const [inviteName, setInviteName] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const normalizedInitial = [character.id, ...initial.filter((id) => id !== character.id)];
  const dirty = formation.join(',') !== normalizedInitial.join(',');
  const singleLocked = Boolean(multiplayer?.active);

  const refreshMultiplayer = async () => {
    const status = await api.multiplayerParty(character.id);
    setMultiplayer(status);
    return status;
  };

  const refreshCharacter = async () => {
    const result = await api.character(character.id);
    onSaved(result.character);
    const ids = result.character.partyMemberIds ?? [result.character.id];
    setFormation([result.character.id, ...ids.filter((id) => id !== result.character.id)]);
    return result.character;
  };

  useEffect(() => {
    let live = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void Promise.all([api.characters(), api.multiplayerParty(character.id)]).then(([result, status]) => {
      if (!live) return;
      setRoster(result.characters);
      setCanCreate(result.account.used < result.account.slots);
      setMultiplayer(status);
    }).catch((reason: Error) => { if (live) setError(reason.message); }).finally(() => { if (live) setLoading(false); });
    const timer = window.setInterval(() => {
      void api.multiplayerParty(character.id).then((status) => { if (live) setMultiplayer(status); }).catch(() => undefined);
    }, 2000);
    return () => { live = false; window.clearInterval(timer); previous?.focus(); };
  }, [character.id]);

  const add = (id: number, position?: number) => {
    if (busy || singleLocked || !roster.some((member) => member.id === id)) return;
    if (id === character.id) return;
    if (!formation.includes(id) && formation.length >= character.partySlots) {
      setError('Desbloqueie outro slot antes de adicionar um personagem.');
      return;
    }
    setFormation((current) => {
      const companions = current.filter((entry) => entry !== character.id && entry !== id);
      const companionPosition = position === undefined ? companions.length : Math.max(0, position - 1);
      companions.splice(companionPosition, 0, id);
      return [character.id, ...companions];
    });
    setError('');
  };

  const drop = (event: DragEvent, position?: number) => {
    event.preventDefault();
    event.stopPropagation();
    const id = Number(event.dataTransfer.getData('text/plain'));
    if (busy || singleLocked || !Number.isInteger(id) || id === character.id) return;
    add(id, position);
  };

  const remove = (id: number) => {
    if (busy || singleLocked || id === character.id) return;
    setFormation((current) => current.filter((entry) => entry !== id));
    setError('');
  };

  const card = (id: number, inFormation: boolean) => {
    const member = roster.find((entry) => entry.id === id);
    if (!member) return null;
    const isPrincipal = id === character.id;
    return <div className={'party-formation-card' + (isPrincipal ? ' selected' : '')} key={id}
      draggable={!busy && !singleLocked && !isPrincipal}
      onDragStart={(event) => {
        if (isPrincipal || singleLocked) { event.preventDefault(); return; }
        event.dataTransfer.setData('text/plain', String(id));
        event.dataTransfer.effectAllowed = 'move';
      }}>
      {inFormation && !isPrincipal && <button type="button" className="party-card-remove" onClick={() => remove(id)} disabled={busy || singleLocked} aria-label={'Remover ' + member.name}>×</button>}
      <PartyPortrait appearance={member.appearance} />
      <strong>{member.name}</strong><small>{member.vocation.name} · lvl {member.level}</small>
      {inFormation
        ? isPrincipal
          ? <span className="party-manager-hint" style={{ color: '#d8a52b', fontWeight: 700 }}>Principal</span>
          : <span className="party-manager-hint">Membro da party</span>
        : <button type="button" className="party-card-primary" disabled={busy || singleLocked || formation.length >= character.partySlots} onClick={() => add(id)}>Adicionar</button>}
    </div>;
  };

  const available = roster.filter((member) => !formation.includes(member.id)
    && (!member.partyMemberIds || member.partyMemberIds.length < 2 || member.partyMemberIds[0] === character.id));
  const principal = roster.find((member) => member.id === character.id) ?? character;

  const multiplayerAction = async (work: () => Promise<MultiplayerPartyStatus>, refresh = false) => {
    setBusy(true); setError('');
    try {
      const status = await work();
      setMultiplayer(status);
      if (refresh) await refreshCharacter();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a party multiplayer.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal party-manager-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <div className="party-manager" role="dialog" aria-modal="true" aria-labelledby="party-manager-title" ref={dialog} tabIndex={-1} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key !== 'Tab') return;
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]') ?? [])];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="party-manager-tabs" role="tablist" aria-label="Modo da party">
        <button role="tab" aria-selected={tab === 'single'} onClick={() => setTab('single')}>Single Player</button>
        <button role="tab" aria-selected={tab === 'multi'} onClick={() => setTab('multi')}>Multiplayer</button>
      </div>
      <h2 id="party-manager-title">Gerenciar party</h2>
      <div className="party-manager-scroll" role="tabpanel">
        {tab === 'single' ? <>
          {singleLocked && <p className="party-manager-error"><strong>Party pessoal suspensa.</strong> Enquanto você estiver em uma party multiplayer, somente o seu personagem atual participa. Seus outros personagens voltam automaticamente quando você sair do multiplayer.</p>}
          <p>O personagem principal é fixo e lidera a party. Os demais personagens podem ser adicionados, removidos e reorganizados como membros.</p>
          <h3>Principal</h3>
          <div className="party-primary-drop">
            <div className="party-formation-card selected">
              <PartyPortrait appearance={principal.appearance} />
              <strong>{principal.name}</strong>
              <small>{principal.vocation.name} · lvl {principal.level}</small>
              <span className="party-manager-hint" style={{ color: '#d8a52b', fontWeight: 700 }}>Principal</span>
            </div>
          </div>
          <h3>Formação <span>{formation.length}/{character.partySlots}</span></h3>
          <div className="party-formation" onDragOver={(event) => { if (!singleLocked) event.preventDefault(); }} onDrop={(event) => drop(event)}>
            {formation.map((id, index) => <div className="party-formation-slot" key={id}
              onDragOver={(event) => { if (!singleLocked && id !== character.id) event.preventDefault(); }}
              onDrop={(event) => { if (!singleLocked && id !== character.id) drop(event, index); }}>
              {card(id, true)}
            </div>)}
            {Array.from({ length: Math.max(0, character.partySlots - formation.length) }, (_, index) => <div className="party-formation-slot vacant" key={'empty-' + index}>{singleLocked ? 'Suspenso' : 'Arraste aqui'}</div>)}
          </div>
          <h3>Seus personagens</h3>
          {loading ? <p>Carregando personagens…</p> : <div className="party-available">{available.map((member) => card(member.id, false))}{!available.length && <p>Todos os personagens disponíveis já estão na formação.</p>}</div>}
          {canCreate && !singleLocked && <form className="party-create" onSubmit={(event) => {
            event.preventDefault(); setBusy(true); setError('');
            void api.createCharacter(name.trim(), vocationId).then(async (result) => {
              const refreshed = await api.characters(); setRoster(refreshed.characters); setCanCreate(refreshed.account.used < refreshed.account.slots); setName('');
              if (formation.length < character.partySlots) setFormation((current) => [character.id, ...current.filter((id) => id !== character.id), result.character.id]);
            }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false));
          }}>
            <label>Novo personagem<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={24} required disabled={busy} placeholder="Nome" /></label>
            <label>Vocação<select value={vocationId} onChange={(event) => setVocationId(Number(event.target.value))} disabled={busy}>{PLAYABLE_VOCATION_IDS.map((id) => <option value={id} key={id}>{vocationsById.get(id)?.name}</option>)}</select></label>
            <button type="submit" disabled={busy || !name.trim()}>Criar personagem</button>
          </form>}
          <p className="party-manager-hint">A formação pessoal é preservada. Ao entrar no multiplayer, ela fica suspensa e retorna quando a party multiplayer terminar.</p>
        </> : <div className="party-multiplayer-info">
          <h3>Party Multiplayer</h3>
          <p>Cada conta pode levar somente <strong>um personagem</strong>. Seus companions da própria conta e os companions do seu amigo ficam fora enquanto a party multiplayer estiver ativa.</p>

          {multiplayer?.invite && !multiplayer.active && <div className="party-primary-drop">
            <div className="party-formation-card selected">
              <strong>Convite recebido</strong>
              <small>{multiplayer.invite.fromName} quer jogar com você.</small>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" disabled={busy} onClick={() => void multiplayerAction(async () => (await api.acceptMultiplayerParty(character.id)).status, true)}>Aceitar</button>
                <button type="button" disabled={busy} onClick={() => void multiplayerAction(async () => (await api.declineMultiplayerParty(character.id)).status)}>Recusar</button>
              </div>
            </div>
          </div>}

          {multiplayer?.active ? <>
            <h3>Membros <span>{multiplayer.members.length}/{multiplayer.maxMembers}</span></h3>
            <div className="party-available">
              {multiplayer.members.map((member) => <div className={'party-formation-card' + (member.id === multiplayer.leaderId ? ' selected' : '')} key={member.id}>
                <PartyPortrait appearance={member.appearance} />
                <strong>{member.name}</strong>
                <small>Level {member.level}{member.id === character.id ? ' · Você' : ''}</small>
                <span className="party-manager-hint">{member.id === multiplayer.leaderId ? 'Líder multiplayer' : 'Jogador'}</span>
                {multiplayer.isLeader && member.id !== character.id && <button type="button" className="party-card-primary" disabled={busy} onClick={() => void multiplayerAction(async () => (await api.removeMultiplayerPartyMember(character.id, member.id)).status, true)}>Remover</button>}
              </div>)}
            </div>
            {multiplayer.isLeader && multiplayer.members.length < multiplayer.maxMembers && <form className="party-create" onSubmit={(event) => {
              event.preventDefault();
              const target = inviteName.trim();
              if (!target) return;
              void multiplayerAction(async () => {
                const result = await api.inviteMultiplayerParty(character.id, target);
                setInviteName('');
                return result.status;
              });
            }}>
              <label>Convidar outro jogador<input value={inviteName} onChange={(event) => setInviteName(event.target.value)} disabled={busy} placeholder="Nome do personagem" /></label>
              <button type="submit" disabled={busy || !inviteName.trim()}>Enviar convite</button>
            </form>}
            <button type="button" disabled={busy} onClick={() => void multiplayerAction(async () => (await api.leaveMultiplayerParty(character.id)).status, true)}>{multiplayer.isLeader ? 'Encerrar party multiplayer' : 'Sair da party multiplayer'}</button>
            <p className="party-manager-hint">O líder inicia a hunt e o servidor tenta colocar todos os jogadores da party na mesma cave. Se algum membro não puder entrar, a entrada é cancelada para evitar separar o grupo.</p>
          </> : <>
            <form className="party-create" onSubmit={(event) => {
              event.preventDefault();
              const target = inviteName.trim();
              if (!target) return;
              void multiplayerAction(async () => {
                const result = await api.inviteMultiplayerParty(character.id, target);
                setInviteName('');
                return result.status;
              });
            }}>
              <label>Nome do amigo<input value={inviteName} onChange={(event) => setInviteName(event.target.value)} disabled={busy} placeholder="Nome do personagem dele" /></label>
              <button type="submit" disabled={busy || !inviteName.trim()}>Convidar para party</button>
            </form>
            <p className="party-manager-hint">Seu amigo deve abrir Gerenciar party → Multiplayer para aceitar. O convite expira em 15 minutos.</p>
          </>}
          <button type="button" disabled={busy} onClick={() => void refreshMultiplayer().catch((reason: Error) => setError(reason.message))}>Atualizar</button>
        </div>}
      </div>
      {error && <p className="party-manager-error" role="alert">{error}</p>}
      <footer className="party-manager-footer">
        {tab === 'single' && <button type="button" disabled={!dirty || busy || loading || singleLocked} onClick={async () => {
          setBusy(true); setError('');
          try {
            const normalized = [character.id, ...formation.filter((id) => id !== character.id)];
            const result = await api.configureParty(character.id, normalized, character.id);
            onSaved(result.character);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a formação.');
          } finally {
            setBusy(false);
          }
        }}>{singleLocked ? 'Suspenso no multiplayer' : busy ? 'Salvando…' : dirty ? 'Salvar alterações' : 'Nenhuma mudança'}</button>}
        <button type="button" disabled={busy} onClick={onClose}>Fechar</button>
      </footer>
    </div>
  </div>;
}
