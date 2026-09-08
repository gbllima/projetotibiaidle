import SHOOT from './shoot-effects.json' with { type: 'json' };

const ANI = SHOOT as Record<string, number>;

/** 3×3 missile pattern: direction is X, addon is Y. */
export function missileAim(dx: number, dy: number): { direction: number; addon: number } {
  if (dx === 0 && dy === 0) return { direction: 1, addon: 1 };
  const angle = Math.atan2(dy, dx);
  const sector = ((Math.round(angle / (Math.PI / 4)) + 8) % 8);
  const table: Array<{ direction: number; addon: number }> = [
    { direction: 2, addon: 1 },
    { direction: 2, addon: 2 },
    { direction: 1, addon: 2 },
    { direction: 0, addon: 2 },
    { direction: 0, addon: 1 },
    { direction: 0, addon: 0 },
    { direction: 1, addon: 0 },
    { direction: 2, addon: 0 },
  ];
  return table[sector] ?? { direction: 1, addon: 1 };
}

export function shootEffectId(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  const key = name.startsWith('CONST_ANI_') ? name.slice('CONST_ANI_'.length) : name;
  return ANI[key];
}
