export interface TileLike {
  tileX: number;
  tileY: number;
}

export function chebyshevDistance(a: TileLike, b: TileLike): number {
  return Math.max(Math.abs(a.tileX - b.tileX), Math.abs(a.tileY - b.tileY));
}

export function chooseHeroTargetForMonster(
  monster: TileLike,
  player: TileLike,
  allies: TileLike[] = [],
): TileLike | null {
  const candidates = [player, ...allies];
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    if (!best) return current;
    return chebyshevDistance(monster, current) < chebyshevDistance(monster, best) ? current : best;
  }, null as TileLike | null);
}

export function isMeleeVocation(vocationId: number): boolean {
  return vocationId === 4 || vocationId === 8 || vocationId === 9 || vocationId === 10;
}

/**
 * Visual formation distance by vocation. This changes only viewport movement;
 * the authoritative server combat formulas and damage ranges are untouched.
 */
export function desiredCombatRange(vocationId?: number): number {
  const id = vocationId ?? 0;
  if (isMeleeVocation(id)) return 1;
  // Paladins keep a mid-range lane while mages stay one tile further back.
  if (id === 3 || id === 7) return 3;
  if (id === 1 || id === 2 || id === 5 || id === 6) return 4;
  return 3;
}

export function canAllyStrike(ally: TileLike, monster: TileLike, vocationId?: number): boolean {
  return chebyshevDistance(ally, monster) <= desiredCombatRange(vocationId);
}

export function chooseMonsterTargetForAlly(
  ally: TileLike,
  player: TileLike,
  monsters: TileLike[] = [],
): TileLike | null {
  const candidates = monsters.length > 0 ? monsters : [player];
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    if (!best) return current;
    return chebyshevDistance(ally, current) < chebyshevDistance(ally, best) ? current : best;
  }, null as TileLike | null);
}
