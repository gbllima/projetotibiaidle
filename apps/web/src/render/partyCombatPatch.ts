import type { SimEvent } from '@tibia-idle/sim';
import { CombatScene } from './combat.js';

/**
 * Party members are simulated in separate server sessions. Their combat events
 * carry actorId as the character that owns/receives that event. The renderer's
 * default monster AI chooses a nearby hero for presentation, which can make a
 * hit that belongs to an ally appear over the principal instead.
 *
 * Pin each party monster to the member identified by actorId before the normal
 * renderer handles the event. This is presentation-only: damage, HP and combat
 * results remain authoritative on the server.
 */
type SceneInternals = {
  player: unknown | null;
  allies: Map<string, { characterId?: number }>;
  monsterTargets: Map<number, unknown>;
};

type CombatPrototype = {
  playOne(this: SceneInternals, event: SimEvent): void;
  __partyTargetPatchApplied?: boolean;
  __partyTargetOriginalPlayOne?: (this: SceneInternals, event: SimEvent) => void;
};

const prototype = CombatScene.prototype as unknown as CombatPrototype;

if (!prototype.__partyTargetPatchApplied) {
  const original = prototype.playOne;
  prototype.__partyTargetOriginalPlayOne = original;
  prototype.playOne = function patchedPartyPlayOne(this: SceneInternals, event: SimEvent): void {
    if (event.type === 'monster_attack' && event.uid !== undefined && event.actorId !== undefined) {
      const ally = [...this.allies.values()].find((entry) => entry.characterId === event.actorId);
      const target = ally ?? this.player;
      if (target) this.monsterTargets.set(event.uid, target);
    }
    original.call(this, event);
  };
  prototype.__partyTargetPatchApplied = true;
}
