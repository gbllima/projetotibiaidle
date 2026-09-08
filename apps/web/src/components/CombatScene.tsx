import { useEffect, useRef } from 'react';
import type { SimEvent } from '@tibia-idle/sim';
import type { ActiveMonsterView } from '../api/types.js';
import { acquireCombatScene, releaseCombatScene, type PlayerView } from '../render/combat.js';

const PENDING_CAP = 80;

export function CombatScene({
  characterId,
  active,
  player,
  allies = [],
  events,
  huntId,
  decorations = [],
}: {
  characterId: number;
  active: ActiveMonsterView[];
  player: PlayerView;
  allies?: PlayerView[];
  events: SimEvent[];
  huntId: string;
  decorations?: string[];
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
        if (withoutSpawn.length) renderer.play(withoutSpawn);
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
    void renderer.mount(node).then(() => {
      if (cancelled || scene.current !== renderer) return;
      ready.current = true;
      pending.current = [];
      try {
        renderer.resetViewport();
        renderer.setDecorations(latest.current.decorations ?? []);
        renderer.setHunt(latest.current.huntId);
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
      releaseCombatScene(renderer);
    };
  }, [characterId]);

  useEffect(() => {
    if (ready.current) {
      try {
        scene.current?.setHunt(huntId);
      } catch (error) {
        console.error('combat hunt', error);
      }
    }
  }, [huntId]);

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
      pending.current.push(...events);
      if (pending.current.length > PENDING_CAP) {
        pending.current = pending.current.slice(-PENDING_CAP);
      }
    }
    present();
  }, [events]);

  useEffect(() => {
    present();
  }, [active, player, allies]);

  return <div className="scene-host" ref={host} />;
}
