import { useEffect, useState } from 'react';
import type { Spell } from '@tibia-idle/sim';
import { spellIconUrl } from '../render/spellIcon.js';

export function SpellIcon({
  spell,
  size = 32,
  className,
  fallback,
  fallbackClassName,
}: {
  spell: { id: string } & Partial<Spell>;
  size?: number;
  className?: string;
  fallback?: string;
  fallbackClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void spellIconUrl(spell).then((next) => {
      if (alive) setUrl(next);
    });
    return () => { alive = false; };
  }, [spell.id]);

  if (url) {
    return (
      <img
        className={className}
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ imageRendering: 'pixelated' }}
      />
    );
  }

  return fallback ? <span className={fallbackClassName}>{fallback}</span> : null;
}
