import { useEffect, useMemo, useRef } from 'react';
import { exerciseShootForTraining, type ExerciseSkill } from '@tibia-idle/sim';
import { acquireTrainingScene, releaseTrainingScene } from '../render/training.js';
import type { PlayerView } from '../render/combat.js';
import type { CharacterView } from '../api/types.js';

export function TrainingScene({
  roomId,
  player,
  attackMs = 2000,
  exerciseMode = true,
  dummySkill,
  supplies,
}: {
  roomId: string;
  player: PlayerView;
  attackMs?: number;
  exerciseMode?: boolean;
  dummySkill: ExerciseSkill;
  supplies: CharacterView['supplies'];
}) {
  const shootEffect = useMemo(
    () => exerciseShootForTraining(dummySkill, supplies.map((s) => ({ itemId: s.itemId, count: s.count }))),
    [dummySkill, supplies],
  );
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof acquireTrainingScene> | null>(null);
  const ready = useRef(false);
  const latest = useRef({ roomId, player, attackMs, exerciseMode, shootEffect });
  latest.current = { roomId, player, attackMs, exerciseMode, shootEffect };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    const renderer = acquireTrainingScene();
    scene.current = renderer;
    void renderer.mount(node).then(() => {
      if (cancelled || scene.current !== renderer) return;
      ready.current = true;
      renderer.setCadence(latest.current.attackMs, latest.current.exerciseMode);
      renderer.setShootEffect(latest.current.shootEffect);
      renderer.setRoom(latest.current.roomId, latest.current.player);
    }).catch((error) => {
      console.error('training mount', error);
    });
    return () => {
      cancelled = true;
      ready.current = false;
      if (scene.current === renderer) scene.current = null;
      releaseTrainingScene(renderer);
    };
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    scene.current?.setRoom(roomId, player);
  }, [roomId, player]);

  useEffect(() => {
    if (!ready.current) return;
    scene.current?.setCadence(attackMs, exerciseMode);
    scene.current?.setShootEffect(shootEffect);
  }, [attackMs, exerciseMode, shootEffect]);

  return <div className="scene-host training-scene" ref={host} />;
}
