import type { CharacterView } from '../api/types.js';
import type { OverlayId } from './TopNav.js';
import { DepotPanel } from './DepotPanel.js';
import { SystemsPanel as SystemsPanelCore } from './SystemsPanelCore.js';

type Props = {
  overlay: OverlayId;
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export function SystemsPanel(props: Props) {
  if (props.overlay === 'depot') {
    return (
      <DepotPanel
        character={props.character}
        busy={props.busy}
        onClose={props.onClose}
        onAct={props.onAct}
      />
    );
  }

  return <SystemsPanelCore {...props} />;
}
