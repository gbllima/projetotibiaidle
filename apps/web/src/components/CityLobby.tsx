import type { LobbyPlayer } from '../api/types.js';
import type { ReactNode } from 'react';
import './CityLobby.css';

export function CityLobby({
  players: _players,
  selfId: _selfId,
  scene,
  onHunt: _onHunt,
  onTraining: _onTraining,
}: {
  players: LobbyPlayer[];
  selfId: number;
  scene: ReactNode;
  onHunt: () => void;
  onTraining: () => void;
}) {
  return (
    <section className="city-lobby city-lobby--thais">
      <div className="city-lobby__bar city-lobby__bar--thais city-lobby__bar--minimal">
        <div className="city-lobby__place">
          <span className="eyebrow">SAFE ZONE</span>
          <h2>Cidade</h2>
        </div>
      </div>

      <div className="city-lobby__map" aria-label="Cidade - Safe Zone">
        {scene}
      </div>
    </section>
  );
}
