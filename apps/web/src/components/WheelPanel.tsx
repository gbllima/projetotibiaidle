import type { CharacterView, WorldView } from '../api/types.js';

export function WheelPanel({
  character,
  world,
  busy,
  onAct,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const nodes = world?.catalogs.wheel ?? [];

  return (
    <div className="wheel-panel">
      <p className="wheel-lede">
        Wheel of Destiny — invista pontos em bônus permanentes. Libera no <strong>level 50</strong>
        {' '}(pontos = level − 50, até rank 10 por nó).
      </p>
      {character.level < 50 ? (
        <p className="soon">Libera no level 50. Você está no level {character.level}.</p>
      ) : (
        <>
          <p className="wheel-points">
            Pontos livres: <strong>{character.wheelLeft}</strong> / {character.wheelPoints}
          </p>
          <div className="wheel-nodes">
            {nodes.map((node) => {
              const rank = character.wheel[node.id] ?? 0;
              const bonuses = [
                node.damage ? `dmg +${node.damage}%` : '',
                node.defense ? `def +${node.defense}%` : '',
                node.experience ? `xp +${node.experience}%` : '',
                node.loot ? `loot +${node.loot}%` : '',
                node.health ? `hp +${node.health}` : '',
                node.mana ? `mp +${node.mana}` : '',
              ].filter(Boolean).join(' · ');
              return (
                <div className="wheel-node-row" key={node.id}>
                  <div>
                    <strong>{node.name}</strong>
                    <div className="meta">{bonuses || 'Bônus passivo'}</div>
                  </div>
                  <div className="wheel-node-rank">
                    <span>Rank {rank}/10</span>
                    <button
                      className="btn gold"
                      disabled={busy || character.wheelLeft < 1 || rank >= 10}
                      onClick={() => void onAct({ type: 'wheel', node: node.id })}
                    >
                      +1
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
