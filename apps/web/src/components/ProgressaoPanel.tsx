import { useState, type CSSProperties } from 'react';
import type { CharacterView, WorldView } from '../api/types.js';
import { PROGRESSAO_MENU, type ProgressaoView } from '../ui/progressaoIcons.js';
import { ForgePanel } from './ForgePanel.js';
import { ImbuementPanel } from './ImbuementPanel.js';
import { PreyPanel } from './PreyPanel.js';
import { ProgressaoMenuIcon } from './ProgressaoMenuIcon.js';
import { TaskBoardPanel } from './TaskBoardPanel.js';
import { WheelPanel } from './WheelPanel.js';

export type { ProgressaoView } from '../ui/progressaoIcons.js';

const VIEW_TITLE: Record<Exclude<ProgressaoView, 'hub'>, string> = {
  imbuement: 'Imbuements',
  prey: 'Prey',
  wheel: 'Wheel of Destiny',
  task: 'Task Board',
  forge: 'Forja',
};

export function ProgressaoPanel({
  character,
  world,
  busy,
  onAct,
  onTitle,
}: {
  character: CharacterView;
  world: WorldView | null;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onTitle?: (title: string) => void;
}) {
  const [view, setView] = useState<ProgressaoView>('hub');

  const open = (next: ProgressaoView) => {
    setView(next);
    if (next !== 'hub') onTitle?.(VIEW_TITLE[next]);
    else onTitle?.('Progressão');
  };

  const back = () => open('hub');

  if (view === 'hub') {
    return (
      <div className="progressao-panel">
        <p className="progressao-lede">
          Sistemas de progressão do personagem — imbuements, prey, roda, tasks e forja em um só lugar.
        </p>
        <div className="progressao-menu">
          {PROGRESSAO_MENU.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="progressao-menu-card"
              style={{ '--prog-tone': entry.tone } as CSSProperties}
              onClick={() => open(entry.id)}
            >
              <ProgressaoMenuIcon id={entry.id} icon={entry.icon} tone={entry.tone} />
              <span className="progressao-menu-copy">
                <strong>{entry.label}</strong>
                <em>{entry.hint}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="progressao-panel progressao-sub">
      <button type="button" className="progressao-back btn" onClick={back}>
        ← Progressão
      </button>
      {view === 'imbuement' && <ImbuementPanel character={character} world={world} busy={busy} onAct={onAct} />}
      {view === 'prey' && <PreyPanel character={character} busy={busy} onAct={onAct} />}
      {view === 'wheel' && <WheelPanel character={character} world={world} busy={busy} onAct={onAct} />}
      {view === 'task' && <TaskBoardPanel character={character} busy={busy} onAct={onAct} />}
      {view === 'forge' && <ForgePanel character={character} busy={busy} onAct={onAct} />}
    </div>
  );
}
