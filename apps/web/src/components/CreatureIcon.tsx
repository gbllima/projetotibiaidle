import { useEffect, useState } from 'react';
import { creatureIconUrl, creatureIconUrlByLookType } from '../render/creatureIcon.js';

export function CreatureIcon({
  monsterId,
  lookType,
  size = 48,
  label,
  className,
}: {
  monsterId?: string;
  lookType?: number | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = monsterId
      ? creatureIconUrl(monsterId, size)
      : lookType != null
        ? creatureIconUrlByLookType(lookType, size)
        : Promise.resolve(null);

    void load.then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [monsterId, lookType, size]);

  return (
    <div
      className={`creature-icon${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      {src ? (
        <img src={src} alt={label ?? ''} width={size} height={size} />
      ) : (
        <span className="creature-icon-fallback">{label?.slice(0, 2).toUpperCase() ?? '?'}</span>
      )}
    </div>
  );
}
