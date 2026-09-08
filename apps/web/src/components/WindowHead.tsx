import type { ReactNode } from 'react';

export function WindowHead({
  title,
  extra,
  onClose,
  closeLabel = 'Fechar',
  collapsible,
  open,
  onToggle,
}: {
  title: ReactNode;
  extra?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <header className={`window-head ${collapsible ? 'window-head-dock' : ''}`}>
      {collapsible ? (
        <button
          type="button"
          className="window-head-toggle"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? 'Minimizar' : 'Expandir'}
        >
          <span className="window-head-min" aria-hidden>{open ? '−' : '+'}</span>
          <span className="window-head-title">{title}</span>
        </button>
      ) : (
        <div className="window-head-title-wrap">
          <span className="window-head-accent" aria-hidden />
          <h2 className="window-head-title">{title}</h2>
        </div>
      )}
      {extra ? <div className="window-head-extra">{extra}</div> : null}
      {onClose ? (
        <button type="button" className="window-head-close" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
      ) : null}
    </header>
  );
}
