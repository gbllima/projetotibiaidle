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

export function desiredCombatRange(vocationId?: number): number {
  if (isMeleeVocation(vocationId ?? 0)) return 1;
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
