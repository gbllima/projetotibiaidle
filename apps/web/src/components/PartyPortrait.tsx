import { useEffect, useState } from 'react';
import type { CharacterView } from '../api/types.js';
import { outfitIconUrl } from '../render/outfitIcon.js';

export function PartyPortrait({ appearance, size = 40 }: { appearance?: CharacterView['caveParty'][number]['appearance']; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (appearance) void outfitIconUrl(appearance.outfit, size, appearance, appearance.addons ?? 0)
      .then((url) => { if (live) setSrc(url); }).catch(() => {});
    return () => { live = false; };
  }, [appearance?.outfit, appearance?.head, appearance?.body, appearance?.legs, appearance?.feet, appearance?.addons, size]);
  return <span className="party-portrait" style={{ width: size, height: size }} aria-hidden>{src && <img src={src} alt="" width={size} height={size} draggable={false} />}</span>;
}
