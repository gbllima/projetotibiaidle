import { useCallback, useState, type ReactNode } from 'react';
import { WindowHead } from './WindowHead.js';

const KEY = 'tibia-idle.docks';

function read(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Collapsible dock panel — header matches site window chrome. */
export function DockBox({
  id,
  title,
  extra,
  bodyClass = 'body',
  defaultOpen = true,
  children,
}: {
  id: string;
  title: ReactNode;
  extra?: ReactNode;
  bodyClass?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => read()[id] ?? defaultOpen);

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: next }));
      return next;
    });
  }, [id]);

  // The old standalone SET panel is obsolete: equipment and backpack
  // management now live inside Party > Itens.
  if (id === 'set') return null;

  return (
    <section className={`box ${open ? '' : 'collapsed'}`}>
      <WindowHead
        title={title}
        extra={extra}
        collapsible
        open={open}
        onToggle={toggle}
      />
      {open ? <div className={bodyClass}>{children}</div> : null}
    </section>
  );
}
