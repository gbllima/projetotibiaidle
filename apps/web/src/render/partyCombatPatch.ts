import type { SimEvent } from '@tibia-idle/sim';
import { CombatScene } from './combat.js';

/**
 * Party combat is simulated in separate server sessions, but the viewport is a
 * single shared floor. Party-monster uids are namespaced by the server with the
 * member id, so the renderer can make each pack chase the character it really
 * belongs to instead of visually piling every creature onto the principal.
 *
 * Monster-attack events are still authoritative and can pin a creature to the
 * member that actually received the hit. If that member dies, movement ignores
 * the dead target and immediately chooses the nearest living party member until
 * the next server snapshot transfers ownership.
 *
 * The old presentation-only ally strike is also kept disabled: damage numbers
 * must come from real server player_attack events only.
 */
const PARTY_UID_STRIDE = 10_000_000;

type SceneRoot = {
  alpha: number;
  destroyed?: boolean;
};

type SceneEntry = {
  root: SceneRoot;
  characterId?: number;
  lastHealth: number;
  tileX: number;
  tileY: number;
  destX: number;
  destY: number;
  standX?: number;
  standY?: number;
};

type AllyView = {
  id?: number;
  name: string;
  health: number;
};

type SceneInternals = {
  player: SceneEntry | null;
  allies: Map<string, SceneEntry>;
  sprites: Map<number, SceneEntry>;
  monsterTargets: Map<number, SceneEntry>;
};

type SyntheticAllyStrike = (name: string, ally: unknown, target: unknown, delta: number) => void;
type SceneSync = (this: SceneInternals, active: unknown[], player: unknown, allies?: AllyView[]) => void;
type ChaseMonster = (
  this: SceneInternals,
  entry: SceneEntry,
  targetX: number,
  targetY: number,
  reserved: Set<string>,
  salt: number,
) => void;

type CombatPrototype = {
  playOne(this: SceneInternals, event: SimEvent): void;
  sync: SceneSync;
  chaseMonster: ChaseMonster;
  tryAllyStrike: SyntheticAllyStrike;
  __partyTargetPatchApplied?: boolean;
  __partyTargetOriginalPlayOne?: (this: SceneInternals, event: SimEvent) => void;
  __partyMovementPatchApplied?: boolean;
  __partyOriginalSync?: SceneSync;
  __partyOriginalChaseMonster?: ChaseMonster;
  __partySyntheticStrikeDisabled?: boolean;
  __partySyntheticStrikeOriginal?: SyntheticAllyStrike;
};

const authoritativeVictims = new WeakMap<object, Map<number, number>>();

function victimMap(scene: SceneInternals): Map<number, number> {
  let map = authoritativeVictims.get(scene as object);
  if (!map) {
    map = new Map<number, number>();
    authoritativeVictims.set(scene as object, map);
  }
  return map;
}

function isLiving(entry: SceneEntry | null | undefined): entry is SceneEntry {
  return Boolean(entry && !entry.root.destroyed && entry.root.alpha > 0.05 && entry.lastHealth > 0);
}

function partyAllies(scene: SceneInternals): SceneEntry[] {
  // Summons/NPCs have no characterId. Monsters should switch only between real
  // party members, matching the requested MMORPG aggro behaviour.
  return [...scene.allies.values()].filter((entry) => entry.characterId !== undefined);
}

function allyById(scene: SceneInternals, id: number): SceneEntry | undefined {
  return partyAllies(scene).find((entry) => entry.characterId === id);
}

function distance(from: SceneEntry, to: SceneEntry): number {
  return Math.max(Math.abs(from.destX - to.destX), Math.abs(from.destY - to.destY));
}

function nearestLivingHero(scene: SceneInternals, monster: SceneEntry): SceneEntry | null {
  const candidates: SceneEntry[] = [];
  if (isLiving(scene.player)) candidates.push(scene.player);
  for (const ally of partyAllies(scene)) if (isLiving(ally)) candidates.push(ally);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => (
    distance(monster, current) < distance(monster, best) ? current : best
  ));
}

/** Determine the real party target for one rendered creature. */
function targetForMonster(scene: SceneInternals, uid: number, monster: SceneEntry): SceneEntry | null {
  // A real server hit is the strongest signal. Keep following that victim while
  // they are alive. If the actor is no longer present (dead/left), do not assume
  // it was the principal: fall through to UID ownership and nearest-survivor
  // selection below.
  const forcedId = victimMap(scene).get(uid);
  if (forcedId !== undefined) {
    const forcedAlly = allyById(scene, forcedId);
    if (isLiving(forcedAlly)) return forcedAlly;
  }

  // Secondary sessions are namespaced as memberId * stride + localUid.
  if (uid >= PARTY_UID_STRIDE) {
    const ownerId = Math.floor(uid / PARTY_UID_STRIDE);
    const owner = allyById(scene, ownerId);
    if (isLiving(owner)) return owner;
  } else if (isLiving(scene.player)) {
    // Raw uids belong to the principal session. This is also how authoritative
    // hits on the principal resolve without needing the principal characterId.
    return scene.player;
  }

  // Owner died or left the active hunt: walk to whoever is physically closest.
  return nearestLivingHero(scene, monster);
}

const prototype = CombatScene.prototype as unknown as CombatPrototype;

if (!prototype.__partyTargetPatchApplied) {
  const original = prototype.playOne;
  prototype.__partyTargetOriginalPlayOne = original;
  prototype.playOne = function patchedPartyPlayOne(this: SceneInternals, event: SimEvent): void {
    if (event.type === 'monster_attack' && event.uid !== undefined && event.actorId !== undefined) {
      victimMap(this).set(event.uid, event.actorId);
      const ally = allyById(this, event.actorId);
      const target = ally ?? (event.uid < PARTY_UID_STRIDE ? this.player : null);
      // Keep the final blow on the character that truly received it. A missing
      // namespaced ally means that member has already left/died; in that case
      // movement selects the nearest living survivor instead of the principal.
      if (target) this.monsterTargets.set(event.uid, target);
    }
    original.call(this, event);
  };
  prototype.__partyTargetPatchApplied = true;
}

if (!prototype.__partyMovementPatchApplied) {
  const originalSync = prototype.sync;
  const originalChaseMonster = prototype.chaseMonster;
  prototype.__partyOriginalSync = originalSync;
  prototype.__partyOriginalChaseMonster = originalChaseMonster;

  prototype.sync = function patchedPartySync(
    this: SceneInternals,
    active: unknown[],
    player: unknown,
    allies: AllyView[] = [],
  ): void {
    originalSync.call(this, active, player, allies);

    // Base CombatScene originally seeded new allies with HP=1 and did not keep
    // lastHealth current. Mirror the authoritative snapshot so death can remove
    // that character from aggro selection immediately.
    for (const ally of allies) {
      if (ally.id === undefined) continue;
      const entry = allyById(this, ally.id);
      if (entry) entry.lastHealth = ally.health;
    }

    const victims = victimMap(this);
    for (const uid of [...victims.keys()]) {
      if (!this.sprites.has(uid)) victims.delete(uid);
    }

    // Establish the same ownership on the very first frame, before the first
    // combat event arrives from the socket.
    for (const [uid, monster] of this.sprites) {
      const target = targetForMonster(this, uid, monster);
      if (!target) continue;
      this.monsterTargets.set(uid, target);
      if (target !== this.player) {
        // sync() gives every monster a stand tile around the principal. Clear it
        // for ally-owned monsters so pathfinding surrounds their actual target.
        monster.standX = undefined;
        monster.standY = undefined;
      }
    }
  };

  prototype.chaseMonster = function patchedPartyChaseMonster(
    this: SceneInternals,
    entry: SceneEntry,
    targetX: number,
    targetY: number,
    reserved: Set<string>,
    salt: number,
  ): void {
    // tickWalk's salt is the monster uid. Override its presentation target with
    // the server ownership / nearest-living rule before the normal pathfinder
    // chooses the next SQM.
    const target = targetForMonster(this, salt, entry);
    if (!target) {
      originalChaseMonster.call(this, entry, targetX, targetY, reserved, salt);
      return;
    }

    this.monsterTargets.set(salt, target);
    if (target !== this.player) {
      entry.standX = undefined;
      entry.standY = undefined;
    }
    originalChaseMonster.call(this, entry, target.destX, target.destY, reserved, salt);
  };

  prototype.__partyMovementPatchApplied = true;
}

if (!prototype.__partySyntheticStrikeDisabled) {
  prototype.__partySyntheticStrikeOriginal = prototype.tryAllyStrike;
  prototype.tryAllyStrike = function suppressSyntheticAllyStrike(): void {
    // Intentionally empty: only authoritative server player_attack events may
    // create ally damage numbers/effects in the combat scene.
  };
  prototype.__partySyntheticStrikeDisabled = true;
}
