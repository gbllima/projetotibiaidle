import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { itemsById } from '@tibia-idle/data';
import { itemIconUrl } from '../render/itemIcon.js';
import { ItemTooltip } from './ItemTooltip.js';

export function ItemSlot({
  itemId,
  count,
  locked,
  label,
  emptyLabel,
  rarity,
  compact,
  showInfo = true,
  onClick,
  onContextMenu,
  onInspect,
}: {
  itemId?: number;
  count?: number;
  locked?: boolean;
  label?: string;
  emptyLabel?: string;
  rarity?: string;
  compact?: boolean;
  /** Hover tooltip + double-click inspect. */
  showInfo?: boolean;
  onClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  onInspect?: (itemId: number) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!itemId) {
      setSrc(null);
      return;
    }
    let live = true;
    void itemIconUrl(itemId).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  const clearHover = () => {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setTooltip(null);
  };

  const handleMouseEnter = (event: MouseEvent) => {
    if (!showInfo || !itemId) return;
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      setTooltip({ x: event.clientX, y: event.clientY });
    }, 220);
  };

  const handleMouseLeave = () => {
    clearHover();
  };

  const handleClick = (event: MouseEvent) => {
    if (!itemId) return;
    if (event.detail >= 2 && onInspect) {
      event.preventDefault();
      event.stopPropagation();
      clearHover();
      onInspect(itemId);
      return;
    }
    if (onClick) onClick(event);
  };

  if (locked) return <div className="cell locked">SLOT<br />BLOQUEADO</div>;

  const name = label ?? itemsById.get(itemId ?? 0)?.name;

  return (
    <>
      <div
        className={`cell ${compact ? 'compact' : ''} ${rarity && rarity !== 'common' ? rarity : ''} ${itemId && (onClick || onInspect) ? 'clickable' : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={(event) => {
          if (tooltip) setTooltip({ x: event.clientX, y: event.clientY });
        }}
        onClick={itemId && (onClick || onInspect) ? handleClick : undefined}
        onContextMenu={itemId && onContextMenu ? (event) => onContextMenu(event) : undefined}
      >
        {src ? <img src={src} alt={name ?? ''} /> : itemId ? <span className="slot-label">{(name ?? `#${itemId}`).slice(0, 8)}</span> : emptyLabel ? <span className="slot-label">{emptyLabel}</span> : null}
        {count && count > 0 ? <span className="qty">{count}</span> : null}
      </div>
      {tooltip && itemId && showInfo && (
        <ItemTooltip itemId={itemId} x={tooltip.x} y={tooltip.y} />
      )}
    </>
  );
}
