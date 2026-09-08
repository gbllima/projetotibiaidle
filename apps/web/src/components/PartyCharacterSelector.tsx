import { useEffect, useRef, useState } from 'react';
import { LiveSocket } from '../api/client.js';
import type { CharacterView } from '../api/types.js';

interface Props {
  characters: CharacterView[];
  currentCharacterId: number;
  partySlots: number;
  currentHuntId: string | null;
  onAdd: (characterId: number) => Promise<void>;
}

export function PartyCharacterSelector({ characters, currentCharacterId, partySlots, currentHuntId, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sockets = useRef<LiveSocket[]>([]);
  const available = characters.filter((character) => character.id !== currentCharacterId);

  useEffect(() => () => {
    for (const socket of sockets.current) socket.close();
    sockets.current = [];
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
    if (busy || !currentHuntId || partySlots < 2) return;
    setBusy(true);
    try {
      await onAdd(characterId);
      const socket = new LiveSocket(characterId, () => undefined, () => undefined);
      sockets.current.push(socket);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-party-selector
      style={{
        position: 'fixed',
        right: 22,
        top: 92,
        zIndex: 1000,
        minWidth: 230,
      }}
    >
      <button
        type="button"
        className="btn gold"
        disabled={!currentHuntId || partySlots < 2 || available.length === 0 || busy}
        onClick={() => setOpen((value) => !value)}
        title={!currentHuntId ? 'Entre em uma cave primeiro' : partySlots < 2 ? 'Desbloqueie o segundo slot da party' : 'Adicionar personagem'}
        style={{ width: '100%', fontWeight: 700 }}
      >
        {busy ? 'Adicionando…' : '⚔ + Adicionar personagem'}
      </button>
      {open && available.length > 0 && (
        <div
          style={{
            marginTop: 6,
            padding: 6,
            background: 'rgba(20, 17, 13, 0.98)',
            border: '1px solid rgba(212, 171, 83, 0.55)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}
        >
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
        </div>
      )}
    </div>
  );
}
