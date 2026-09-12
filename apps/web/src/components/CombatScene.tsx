import { useEffect, useRef } from 'react';
import type { SimEvent } from '@tibia-idle/sim';
import type { ActiveMonsterView } from '../api/types.js';
import { acquireCombatScene, releaseCombatScene, type PlayerView } from '../render/combat.js';
import '../render/partyCombatPatch.js';

const PENDING_CAP = 80;
const RENDER_CAP = 40;
const ATTACK_WINDOW_TICKS = 3;
const CAST_WINDOW_TICKS = 8;

/**
 * Compact only the renderer feed. Combat, XP, loot and the combat log still use
 * every server event. This keeps party hunts readable without nerfing damage.
 */
function compactVisualEvents(events: SimEvent[]): SimEvent[] {
  const output: SimEvent[] = [];
  const buckets = new Map<string, number>();

  const addOrMerge = (key: string, event: SimEvent) => {
    const index = buckets.get(key);
    if (index === undefined) {
      buckets.set(key, output.length);
      output.push({ ...event });
      return;
    }
    const previous = output[index]!;
    output[index] = {
      ...previous,
      amount: (previous.amount ?? 0) + (event.amount ?? 0),
      critical: previous.critical || event.critical,
      fatal: previous.fatal || event.fatal,
      leech: (previous.leech ?? 0) + (event.leech ?? 0) || undefined,
    };
  };

  for (const event of events) {
    const actor = event.actorId ?? 0;

    if (event.type === 'player_attack') {
      // Spell words are useful once, but three party members can otherwise cover
      // the viewport with repeated incantations during the same cast window.
      if (event.words && event.uid === undefined && (event.amount ?? 0) <= 0) {
        const key = `cast:${actor}:${event.words}:${Math.floor(event.tick / CAST_WINDOW_TICKS)}`;
        if (!buckets.has(key)) {
          buckets.set(key, output.length);
          output.push({ ...event });
        }
        continue;
      }

      if ((event.amount ?? 0) > 0) {
        const window = Math.floor(event.tick / ATTACK_WINDOW_TICKS);
        // One visual number for an AoE cast instead of one number per creature.
        // The summed number is presentation-only; monster HP still receives all hits.
        const key = event.area
          ? `aoe:${actor}:${event.damageType ?? ''}:${window}`
          : `hit:${actor}:${event.uid ?? 0}:${event.damageType ?? ''}:${window}`;
        addOrMerge(key, event);
        continue;
      }
    }

    if (event.type === 'monster_attack' && (event.amount ?? 0) > 0) {
      // Party snapshots carry actorId as the member who received this hit.
      // Keep each victim in a separate visual bucket; otherwise attacks from
      // different members can be merged and appear as mysterious damage on the
      // first member represented by that bucket.
      const key = `monster:${actor}:${event.monsterId ?? event.uid ?? 0}:${Math.floor(event.tick / ATTACK_WINDOW_TICKS)}`;
      addOrMerge(key, event);
      continue;
    }

    output.push(event);
  }

  return output.slice(-RENDER_CAP);
}

export function CombatScene({
  characterId,
  active,
  player,
  allies = [],
  events,
  huntId,
  decorations = [],
  cityLobby = false,
  onCityMove,
  onCityMerchant,
}: {
  characterId: number;
  active: ActiveMonsterView[];
  player: PlayerView;
  allies?: PlayerView[];
  events: SimEvent[];
  huntId: string;
  decorations?: string[];
  cityLobby?: boolean;
  onCityMerchant?: () => void;
  onCityMove?: (position: { x: number; y: number }) => Promise<{ position: { x: number; y: number }; accepted: boolean }>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof acquireCombatScene> | null>(null);
  const ready = useRef(false);
  const booted = useRef(false);
  const pending = useRef<SimEvent[]>([]);
  const latest = useRef({ active, player, allies, huntId, decorations });
  latest.current = { active, player, allies, huntId, decorations };

  function present() {
    const renderer = scene.current;
    if (!ready.current || !renderer) return;
    const queued = pending.current;
    pending.current = [];
    // Play hits/deaths before sync so killing blows still find the sprite.
    // Skip monster_spawn — sync paints the whole pack at once.
    if (booted.current && queued.length) {
      try {
        const withoutSpawn = queued.filter((event) => event.type !== 'monster_spawn');
        const visualEvents = compactVisualEvents(withoutSpawn);
        if (visualEvents.length) renderer.play(visualEvents);
      } catch (error) {
        console.error('combat play', error);
      }
    }
    try {
      const snap = latest.current;
      renderer.sync(snap.active ?? [], snap.player, snap.allies ?? []);
    } catch (error) {
      console.error('combat sync', error);
    }
    booted.current = true;
  }

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    const renderer = acquireCombatScene();
    scene.current = renderer;
    renderer.setCityMove(onCityMove);
    renderer.setCityMerchant(onCityMerchant);
    void renderer.mount(node).then(() => {
      if (cancelled || scene.current !== renderer) return;
      ready.current = true;
      pending.current = [];
      try {
        renderer.resetViewport();
        renderer.setDecorations(latest.current.decorations ?? []);
        if (cityLobby) renderer.setCityLobby();
        else renderer.setHunt(latest.current.huntId);
      } catch (error) {
        console.error('combat floor', error);
      }
      present();
    }).catch((error) => {
      console.error('combat mount', error);
    });
    return () => {
      cancelled = true;
      ready.current = false;
      booted.current = false;
      pending.current = [];
      if (scene.current === renderer) scene.current = null;
      renderer.setCityMerchant(undefined);
      releaseCombatScene(renderer);
    };
  }, [characterId, cityLobby]);

  useEffect(() => {
    if (ready.current && !cityLobby) {
      try {
        scene.current?.setHunt(huntId);
      } catch (error) {
        console.error('combat hunt', error);
      }
    }
  }, [huntId, cityLobby]);

  useEffect(() => {
    if (ready.current) {
      try {
        scene.current?.setDecorations(decorations ?? []);
      } catch (error) {
        console.error('combat decorations', error);
      }
    }
  }, [decorations]);

  useEffect(() => {
    if (events.length) {
      // The principal simulation does not need actorId internally because damage
      // always applies to its own character. The shared renderer does: without
      // it, its presentation AI may draw that hit over a different party member.
      const targeted = events.map((event) => (
        event.type === 'monster_attack' && event.actorId === undefined
          ? { ...event, actorId: characterId }
          : event
      ));
      pending.current.push(...targeted);
      if (pending.current.length > PENDING_CAP) {
        pending.current = pending.current.slice(-PENDING_CAP);
      }
    }
    present();
  }, [events, characterId]);

  useEffect(() => {
    present();
  }, [active, player, allies]);

  return <div className="scene-host" ref={host} />;
}
