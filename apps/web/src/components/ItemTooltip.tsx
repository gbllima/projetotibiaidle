import { createPortal } from 'react-dom';
import { itemsById } from '@tibia-idle/data';
import { itemDisplayName, itemTooltipLines } from '../itemFormat.js';

export function ItemTooltip({
  itemId,
  x,
  y,
}: {
  itemId: number;
  x: number;
  y: number;
}) {
  const item = itemsById.get(itemId);
  if (!item) return null;

  const lines = itemTooltipLines(itemId);
  const left = Math.min(x + 12, window.innerWidth - 240);
  const top = Math.min(y + 12, window.innerHeight - 280);

  return createPortal(
    <div className="item-tooltip" style={{ left, top }} role="tooltip">
      <strong>{itemDisplayName(item)}</strong>
      {item.description && <p className="item-tooltip-desc">{item.description}</p>}
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>,
    document.body,
  );
}
