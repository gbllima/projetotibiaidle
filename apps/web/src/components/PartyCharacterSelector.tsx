import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PLAYABLE_VOCATION_IDS, vocationsById } from '@tibia-idle/data';
import { LiveSocket } from '../api/client.js';
import type { AccountView, CharacterView } from '../api/types.js';

type CreatePartyCharacterInput = {
  name: string;
  vocationId: number;
  gender: 'm' | 'f';
  weapon: 'axe' | 'sword' | 'club';
};

interface Props {
  characters: CharacterView[];
  account: AccountView | null;
  currentCharacterId: number;
  partySlots: number;
  currentHuntId: string | null;
  onAdd: (characterId: number) => Promise<void>;
  onCreate: (input: CreatePartyCharacterInput) => Promise<number>;
}

export function PartyCharacterSelector({ characters, account, currentCharacterId, partySlots, currentHuntId, onAdd, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [vocationId, setVocationId] = useState(4);
  const [gender, setGender] = useState<'m' | 'f'>('m');
  const [weapon, setWeapon] = useState<'axe' | 'sword' | 'club'>('sword');
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const sockets = useRef<LiveSocket[]>([]);
  const available = characters.filter((character) => character.id !== currentCharacterId);

  useEffect(() => () => {
    for (const socket of sockets.current) socket.close();
    sockets.current = [];
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const outfit = document.querySelector<HTMLElement>('.party-outfit-btn');
      if (!outfit) return;
      const rect = outfit.getBoundingClientRect();
      setPosition({
        top: Math.round(rect.bottom + 2),
        right: Math.max(12, Math.round(window.innerWidth - rect.right)),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const timer = window.setInterval(updatePosition, 1000);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement)?.closest('[data-party-selector]')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const add = async (characterId: number) => {
    if (busy) return;
    if (!currentHuntId) {
      setError('Entre em uma cave antes de adicionar um personagem.');
      return;
    }
    if (partySlots < 2) {
      setError('Desbloqueie o segundo slot da party antes de adicionar um personagem.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(characterId);
      const socket = new LiveSocket(characterId, () => undefined, () => undefined);
      sockets.current.push(socket);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o personagem.');
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError('Informe um nome para o personagem.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const characterId = await onCreate({ name: name.trim(), vocationId, gender, weapon });
      const socket = new LiveSocket(characterId, () => undefined, () => undefined);
      sockets.current.push(socket);
      setName('');
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar o personagem.');
    } finally {
      setBusy(false);
    }
  };

  const accountFull = account !== null && account.used >= account.slots;

  return (
    <div
      data-party-selector
      style={{
        position: 'fixed',
        top: position.top,
        right: position.right,
        zIndex: 1000,
        width: 'max-content',
      }}
    >
      <button
        type="button"
        className="btn gold"
        aria-label="Adicionar personagem"
        disabled={busy}
        onClick={() => {
          setError(null);
          if (!currentHuntId) {
            setError('Entre em uma cave antes de adicionar um personagem.');
            return;
          }
          if (partySlots < 2) {
            setError('Desbloqueie o segundo slot da party antes de adicionar um personagem.');
            return;
          }
          setOpen((value) => !value);
        }}
        title="Adicionar personagem"
        style={{ fontSize: 10, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {busy ? '…' : '+'}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 6, padding: '6px 8px', color: '#ffb4a8', fontSize: 11, background: 'rgba(100, 24, 20, 0.9)', border: '1px solid rgba(255, 120, 100, 0.45)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {open && (
        <div
          style={{
            marginTop: 6,
            padding: 6,
            width: 230,
            boxSizing: 'border-box',
            background: 'rgba(20, 17, 13, 0.98)',
            border: '1px solid rgba(212, 171, 83, 0.55)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}
        >
          {available.length > 0 && (
            <>
              <div style={{ padding: '5px 7px', fontSize: 11, opacity: 0.75 }}>PERSONAGENS DA CONTA</div>
              {available.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className="btn"
                  onClick={() => void add(character.id)}
                  disabled={busy}
                  style={{ width: '100%', display: 'block', textAlign: 'left', marginTop: 4 }}
                >
                  <strong>{character.name}</strong>
                  <span> · {character.vocation.name} · Lv {character.level}</span>
                </button>
              ))}
            </>
          )}
          <form onSubmit={(event) => void create(event)} style={{ marginTop: 8, borderTop: '1px solid rgba(212, 171, 83, 0.3)', paddingTop: 8 }}>
            <div style={{ padding: '0 7px 5px', fontSize: 11, opacity: 0.75 }}>CRIAR E ADICIONAR</div>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={20}
              placeholder="Nome do personagem"
              disabled={busy || accountFull}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <select value={vocationId} onChange={(event) => setVocationId(Number(event.target.value))} disabled={busy || accountFull} style={{ width: '100%', marginTop: 4 }}>
              {PLAYABLE_VOCATION_IDS.map((id) => <option key={id} value={id}>{vocationsById.get(id)?.name ?? id}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button type="button" className={`btn ${gender === 'm' ? 'gold' : ''}`} onClick={() => setGender('m')} disabled={busy || accountFull}>Masculino</button>
              <button type="button" className={`btn ${gender === 'f' ? 'gold' : ''}`} onClick={() => setGender('f')} disabled={busy || accountFull}>Feminino</button>
            </div>
            {vocationId === 4 && (
              <select value={weapon} onChange={(event) => setWeapon(event.target.value as typeof weapon)} disabled={busy || accountFull} style={{ width: '100%', marginTop: 4 }}>
                <option value="sword">Espada</option>
                <option value="axe">Machado</option>
                <option value="club">Clava</option>
              </select>
            )}
            {accountFull && <div style={{ marginTop: 5, fontSize: 11, color: '#ffb4a8' }}>Limite de personagens atingido.</div>}
            <button type="submit" className="btn gold" disabled={busy || accountFull} style={{ width: '100%', marginTop: 6 }}>
              {busy ? 'Criando…' : 'Criar e adicionar'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
