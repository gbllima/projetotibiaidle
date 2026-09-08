import { useEffect, useState } from 'react';
import type { CharacterView } from '../api/types';

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
  const available = characters.filter((character) => character.id !== currentCharacterId);

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
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-party-selector style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={!currentHuntId || partySlots < 2 || available.length === 0 || busy}
        onClick={() => setOpen((value) => !value)}
        title={!currentHuntId ? 'Entre em uma cave primeiro' : partySlots < 2 ? 'Desbloqueie o segundo slot da party' : 'Adicionar personagem'}
      >
        {busy ? 'Adicionando…' : '+ Adicionar personagem'}
      </button>
      {open && available.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 20, right: 0, top: 'calc(100% + 6px)', minWidth: 220 }}>
          {available.map((character) => (
            <button key={character.id} type="button" onClick={() => void add(character.id)} disabled={busy}>
              <strong>{character.name}</strong>
              <span> {character.vocation.name} · Lv {character.level}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
