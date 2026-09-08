import { itemsById } from '@tibia-idle/data';
import { ItemDetailPanel } from './ItemDetailPanel.js';
import { WindowHead } from './WindowHead.js';

export function ItemInspectModal({
  itemId,
  onClose,
}: {
  itemId: number;
  onClose: () => void;
}) {
  const item = itemsById.get(itemId);
  if (!item) return null;

  return (
    <div className="modal item-inspect-modal" onClick={onClose}>
      <div className="modal-card compact-modal item-inspect-card" onClick={(event) => event.stopPropagation()}>
        <WindowHead title="Inspecionar" onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">
          <ItemDetailPanel item={item} />
        </div>
      </div>
    </div>
  );
}
