import { monstersById } from '@tibia-idle/data';
import type { CharacterView } from '../api/types.js';
import { CreatureIcon } from './CreatureIcon.js';
import { formatNumber } from '../format.js';

export function TaskBoardPanel({
  character,
  busy,
  onAct,
}: {
  character: CharacterView;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const task = character.task;

  return (
    <div className="task-board-panel">
      <p className="task-board-lede">
        Hunting Task Board — mate criaturas da task para ganhar gold e experiência bônus.
        Trocar task custa <strong>500 gold</strong>.
      </p>
      {task ? (
        <div className="task-board-card">
          <div className="task-board-target">
            <CreatureIcon monsterId={task.monsterId} size={64} label={monstersById.get(task.monsterId)?.name} />
            <div>
              <h3>{monstersById.get(task.monsterId)?.name ?? task.monsterId}</h3>
              <p className="meta">Progresso da caçada</p>
            </div>
          </div>
          <div className="task-board-stats">
            <div>
              <span>Kills</span>
              <strong className={task.claimed ? 'profit' : ''}>
                {task.progress}/{task.required}{task.claimed ? ' ✓' : ''}
              </strong>
            </div>
            <div>
              <span>Gold</span>
              <strong className="goldish">{formatNumber(task.gold)}</strong>
            </div>
            <div>
              <span>Experiência</span>
              <strong>{formatNumber(task.experience)} XP</strong>
            </div>
          </div>
        </div>
      ) : (
        <p className="soon">Nenhuma task ativa. Entre numa hunt ou role uma nova.</p>
      )}
      <button
        className="btn gold task-board-roll"
        disabled={busy}
        onClick={() => void onAct({ type: 'task-roll' })}
      >
        {task && !task.claimed ? 'Trocar task · 500g' : 'Nova task'}
      </button>
    </div>
  );
}
