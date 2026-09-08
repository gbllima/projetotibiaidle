import { useMemo, useState } from 'react';
import type { HuntView } from '../api/types.js';
import { formatRate } from '../format.js';

export function HuntList({
  hunts,
  hunting,
  busy,
  onStart,
  onStop,
}: {
  hunts: HuntView[];
  hunting: boolean;
  busy: boolean;
  onStart: (id: string) => void;
  onStop: () => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return hunts
      .filter((hunt) => !needle || hunt.name.toLowerCase().includes(needle) || hunt.location?.toLowerCase().includes(needle))
      .sort((a, b) => (a.recommendedLevel ?? a.statedLevel) - (b.recommendedLevel ?? b.statedLevel));
  }, [hunts, query]);

  return (
    <aside className="panel">
      <h3>Caçar</h3>
      <input
        className="filter"
        placeholder="Buscar hunt…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {hunting && (
        <button className="btn danger" style={{ width: '100%', marginBottom: 10 }} disabled={busy} onClick={onStop}>
          Encerrar hunt
        </button>
      )}
      {visible.map((hunt) => (
        <button
          key={hunt.id}
          className="hunt"
          disabled={busy || hunting || !hunt.unlocked}
          onClick={() => onStart(hunt.id)}
        >
          <div>{hunt.name}</div>
          <div className="meta">
            <span>lvl {hunt.recommendedLevel ?? hunt.statedLevel}</span>
            <b>{formatRate(hunt.expectedXpPerHour)} XP/h</b>
          </div>
          <div className="meta">
            <span>{hunt.location || 'Tibia'}</span>
            <span>{hunt.unlocked ? `${Math.round(hunt.fit * 100)}% fit` : 'bloqueada'}</span>
          </div>
        </button>
      ))}
    </aside>
  );
}
