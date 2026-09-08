import { useMemo } from 'react';
import { charms, monstersById } from '@tibia-idle/data';
import type { CharacterView } from '../api/types.js';

export function BestiaryPanel({ character }: { character: CharacterView }) {
  const entries = useMemo(() => {
    return Object.entries(character.bestiary)
      .map(([id, kills]) => {
        const monster = monstersById.get(id);
        if (!monster) return null;
        const goal = monster.bestiary?.toKill ?? 0;
        return { id, name: monster.name, kills, goal, stars: monster.bestiary?.stars ?? 0, points: monster.bestiary?.charmPoints ?? 0 };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.kills - a.kills);
  }, [character.bestiary]);

  const charmPoints = entries.reduce((sum, entry) => sum + (entry.goal > 0 && entry.kills >= entry.goal ? entry.points : 0), 0);

  return (
    <aside>
      <h3>Bestiary</h3>
      <p className="lede" style={{ textAlign: 'left' }}>
        {entries.length} espécies · {charmPoints} charm points
      </p>
      <div className="bestiary">
        {entries.length === 0 && <span>Mate o primeiro monstro para abrir o bestiary.</span>}
        {entries.map((entry) => (
          <div className="beast" key={entry.id}>
            <strong style={{ gridColumn: '1 / 2' }}>{entry.stars}★</strong>
            <div>
              <div>{entry.name}</div>
              <small>
                {entry.kills}
                {entry.goal ? ` / ${entry.goal}` : ''}
              </small>
            </div>
            <span>{entry.kills >= entry.goal && entry.goal > 0 ? 'completo' : 'em progresso'}</span>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 22 }}>Charms</h3>
      <div className="bestiary">
        {charms.map((charm) => (
          <div className="beast" key={charm.id}>
            <strong>{charm.category[0]}</strong>
            <div>
              <div>{charm.name}</div>
              <small>
                {charm.type} · {charm.points[0]} pts
              </small>
            </div>
            <span>{charmPoints >= charm.points[0] ? 'disponível' : 'bloqueado'}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
