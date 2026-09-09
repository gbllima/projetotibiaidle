import type { LobbyPlayer } from '../api/types.js';
import type { ReactNode } from 'react';

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
  return (
    <section className="city-lobby">
      <div className="city-lobby__map" aria-label="Cidade principal">{scene}</div>
      <div className="city-lobby__bar">
        <div>
          <span className="eyebrow">Cidade de Tibia</span>
          <h2>Praça Central</h2>
          <p>{players.length} aventureiro{players.length === 1 ? '' : 's'} na cidade</p>
        </div>
        <div className="city-lobby__self">
          <strong>{players.find((player) => player.id === selfId)?.name ?? 'Seu personagem'}</strong>
          <span>{VOCATION_NAMES[players.find((player) => player.id === selfId)?.vocationId ?? 0] ?? 'Aventureiro'}</span>
        </div>
        <div className="city-lobby__actions">
          <button className="btn gold" type="button" onClick={onHunt}>Escolher Hunt</button>
          <button className="btn" type="button" onClick={onTraining}>Treino online</button>
        </div>
      </div>
    </section>
  );
}
