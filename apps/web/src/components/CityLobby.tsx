import type { LobbyPlayer } from '../api/types.js';
import type { ReactNode } from 'react';
import './CityLobby.css';

const VOCATION_NAMES: Record<number, string> = {
  1: 'Sorcerer',
  2: 'Druid',
  3: 'Paladin',
  4: 'Knight',
  9: 'Monk',
};

export function CityLobby({
  players,
  selfId,
  scene,
  onHunt,
  onTraining,
}: {
  players: LobbyPlayer[];
  selfId: number;
  scene: ReactNode;
  onHunt: () => void;
  onTraining: () => void;
}) {
  const self = players.find((player) => player.id === selfId);

  return (
    <section className="city-lobby city-lobby--thais">
      <div className="city-lobby__map" aria-label="Cidade - Safe Zone">
        {scene}
      </div>

      <div className="city-lobby__bar city-lobby__bar--thais">
        <div className="city-lobby__place">
          <span className="eyebrow">SAFE ZONE</span>
          <h2>Cidade</h2>
          <span className="city-lobby__controls">Clique no chão para andar · WASD / setas</span>
          <p>{players.length} aventureiro{players.length === 1 ? '' : 's'} na cidade · fora da hunt</p>
        </div>
        <div className="city-lobby__self">
          <strong>{self?.name ?? 'Seu personagem'}</strong>
          <span>{VOCATION_NAMES[self?.vocationId ?? 0] ?? 'Aventureiro'} · Lv. {self?.level ?? '?'}</span>
        </div>
        <div className="city-lobby__actions">
          <button className="btn gold" type="button" onClick={onHunt}>Escolher Hunt</button>
          <button className="btn" type="button" onClick={onTraining}>Treino online</button>
        </div>
      </div>
    </section>
  );
}
