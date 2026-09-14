import { useEffect, useRef, useState } from 'react';
import type { SimEvent } from '@tibia-idle/sim';
import type { ActiveMonsterView } from '../api/types.js';
import { api } from '../api/client.js';
import { acquireCombatScene, releaseCombatScene, type PlayerView } from '../render/combat.js';
import '../render/partyCombatPatch.js';

const PENDING_CAP = 80;
const RENDER_CAP = 40;
const ATTACK_WINDOW_TICKS = 3;
const CAST_WINDOW_TICKS = 8;
const PARTY_ACTIVITY_REFRESH_MS = 3000;
const EMPTY_PARTY_IDS = new Set<number>();

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
  const [partyActivity, setPartyActivity] = useState<{ huntId: string; activeIds: Set<number> }>(() => ({
    huntId: '',
    activeIds: new Set<number>(),
  }));

  const partyAllyKey = allies
    .flatMap((ally) => ally.id === undefined ? [] : [ally.id])
    .sort((left, right) => left - right)
    .join(',');
  const activePartyIds = partyActivity.huntId === huntId ? partyActivity.activeIds : EMPTY_PARTY_IDS;
  const visibleAllies = cityLobby
    ? allies
    : allies.filter((ally) => ally.dead === true || ally.id === undefined || activePartyIds.has(ally.id));

  const latest = useRef({ active, player, allies: visibleAllies, huntId, decorations });
  latest.current = { active, player, allies: visibleAllies, huntId, decorations };

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
    if (cityLobby) return;
    const ids = partyAllyKey
      ? partyAllyKey.split(',').map((value) => Number(value)).filter((value) => Number.isInteger(value))
      : [];

    if (ids.length === 0) {
      setPartyActivity((current) => (
        current.huntId === huntId && current.activeIds.size === 0
          ? current
          : { huntId, activeIds: new Set<number>() }
      ));
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const expected = new Set(ids);

    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      void api.character(characterId).then(({ character }) => {
        if (cancelled) return;
        const activeIds = new Set<number>();
        const activityHuntId = character.session?.status === 'active'
          ? character.session.huntId
          : character.partyActivity?.huntId;
        if (activityHuntId === huntId) {
          for (const member of character.caveParty ?? []) {
            if (expected.has(member.id) && member.active === true) activeIds.add(member.id);
          }
        }
        setPartyActivity({ huntId, activeIds });
      }).catch(() => undefined).finally(() => {
        inFlight = false;
      });
    };

    setPartyActivity((current) => (
      current.huntId === huntId ? current : { huntId, activeIds: new Set<number>() }
    ));
    refresh();
    const timer = window.setInterval(refresh, PARTY_ACTIVITY_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [characterId, huntId, cityLobby, partyAllyKey]);

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

      if (!cityLobby && partyAllyKey) {
        const partyIds = new Set(partyAllyKey.split(',').map((value) => Number(value)));
        const confirmed = new Set<number>();
        for (const event of targeted) {
          if ((event.type === 'player_attack' || event.type === 'monster_attack')
            && event.actorId !== undefined
            && partyIds.has(event.actorId)) {
            confirmed.add(event.actorId);
          }
        }
        if (confirmed.size > 0) {
          setPartyActivity((current) => {
            const activeIds = current.huntId === huntId
              ? new Set(current.activeIds)
              : new Set<number>();
            for (const id of confirmed) activeIds.add(id);
            return { huntId, activeIds };
          });
        }
      }

      pending.current.push(...targeted);
      if (pending.current.length > PENDING_CAP) {
        pending.current = pending.current.slice(-PENDING_CAP);
      }
    }
    present();
  }, [events, characterId, cityLobby, partyAllyKey, huntId]);

  useEffect(() => {
    present();
  }, [active, player, allies, partyActivity, cityLobby]);

  return <div className="scene-host" ref={host} />;
}
