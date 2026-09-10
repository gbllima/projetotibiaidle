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
      <div className="city-lobby__map" aria-label="Thais - praça do Depot">
        {scene}
        <div className="city-hub-overlay" aria-hidden="true">
          <div className="city-hub-sign city-hub-sign--post">✉ <b>Benjamin</b><span>Correio</span></div>
          <div className="city-hub-sign city-hub-sign--team">👥 <b>Team Finder</b><span>Montar equipe</span></div>
          <div className="city-hub-sign city-hub-sign--depot">🎒 <b>Depot</b><span>Warehouse</span></div>
          <div className="city-hub-sign city-hub-sign--bank">🪙 <b>Bank</b><span>Banco</span></div>
          <div className="city-hub-sign city-hub-sign--store">💰 <b>Store</b><span>Mercador</span></div>
          <div className="city-hub-sign city-hub-sign--temple">✦ <b>Temple</b><span>Descanso</span></div>
          <div className="city-hub-fountain">✦</div>
        </div>
      </div>

      <div className="city-lobby__bar city-lobby__bar--thais">
        <div className="city-lobby__place">
          <span className="eyebrow">THAIS · SAFE ZONE</span>
          <h2>Praça do Depot</h2>
          <p>{players.length} aventureiro{players.length === 1 ? '' : 's'} na cidade · stamina em descanso fora da hunt</p>
        </div>
        <div className="city-lobby__self">
          <strong>{self?.name ?? 'Seu personagem'}</strong>
          <span>{VOCATION_NAMES[self?.vocationId ?? 0] ?? 'Aventureiro'} · Lv. {self?.level ?? '?'}</span>
        </div>
        <div className="city-lobby__actions">
          <button className="btn gold" type="button" onClick={onHunt}>⚔ Escolher Hunt</button>
          <button className="btn" type="button" onClick={onTraining}>⚒ Treino online</button>
        </div>
      </div>

      <div className="city-hub-services" aria-label="Serviços de Thais">
        <button type="button" onClick={onHunt}><span>⚔</span><b>Hunts</b><small>Escolher destino</small></button>
        <button type="button" onClick={onTraining}><span>⚒</span><b>Treino</b><small>Área de treinamento</small></button>
        <div><span>👥</span><b>Team Finder</b><small>Party e jogadores</small></div>
        <div><span>🎒</span><b>Depot</b><small>Itens e armazém</small></div>
        <div><span>🪙</span><b>Bank</b><small>Serviços da cidade</small></div>
        <div><span>✦</span><b>Temple</b><small>Safe zone</small></div>
      </div>
    </section>
  );
}
