import { CombatScene } from './combat.js';

/**
 * CombatScene renders inside a world scaled x2. The original 9-10px Pixi text
 * therefore appears as roughly 18-20px on screen and can cover creatures when
 * several hits happen together. Keep the existing combat/event logic intact
 * and only compact the final floating-text size before Pixi draws it.
 */
type CombatSceneTextPrototype = {
  spawnFloater(
    this: CombatScene,
    x: number,
    y: number,
    label: string,
    color: number,
    size: number,
    life: number,
  ): void;
  __compactCombatTextPatched?: boolean;
};

const prototype = CombatScene.prototype as unknown as CombatSceneTextPrototype;

if (!prototype.__compactCombatTextPatched && typeof prototype.spawnFloater === 'function') {
  const originalSpawnFloater = prototype.spawnFloater;

  prototype.spawnFloater = function compactCombatText(
    this: CombatScene,
    x: number,
    y: number,
    label: string,
    color: number,
    size: number,
    life: number,
  ): void {
    // World scale is x2:
    //  9 -> 7  = ~14px on screen (normal damage/heal/spell words)
    // 10 -> 8  = ~16px on screen (critical/combo)
    // 11 -> 9  = ~18px on screen (level-up / special emphasis)
    const compactSize = size >= 11 ? 9 : size >= 10 ? 8 : size >= 9 ? 7 : Math.max(6, size);
    originalSpawnFloater.call(this, x, y, label, color, compactSize, life);
  };

  prototype.__compactCombatTextPatched = true;
}
