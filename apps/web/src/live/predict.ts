import { useEffect, useRef, useState } from 'react';

import { itemsById } from '@tibia-idle/data';

import {

  advance, deriveStats, describeSession, TICK_MS, clonePolicy,

  type CharacterState, type EquipSlot, type HuntSession, type SimEvent, type HuntPolicy,

} from '@tibia-idle/sim';

import type { CharacterView } from '../api/types.js';



function suppliesKey(stacks: Array<{ itemId: number; count: number }>): string {

  return stacks.map((stack) => `${stack.itemId}:${stack.count}`).join('|');

}



function equipmentKey(equipment: CharacterView['equipment']): string {

  return Object.entries(equipment)

    .sort(([a], [b]) => a.localeCompare(b))

    .map(([slot, item]) => `${slot}:${item.id}`)

    .join('|');

}



function tiersKey(tiers: CharacterView['equipmentTiers']): string {

  return Object.entries(tiers ?? {})

    .sort(([a], [b]) => a.localeCompare(b))

    .map(([slot, tier]) => `${slot}:${tier}`)

    .join('|');

}



function lootKey(loot: Array<{ itemId: number; count: number }>): string {

  return loot.map((stack) => `${stack.itemId}:${stack.count}`).join('|');

}



function policySyncKey(server: CharacterView): string {

  return JSON.stringify({ policy: server.policy, helperProfiles: server.helperProfiles ?? {} });

}



function inventorySyncKey(server: CharacterView): string {

  return [

    suppliesKey(server.supplies),

    suppliesKey(server.warehouse),

    suppliesKey(server.backpackContents ?? []),

    equipmentKey(server.equipment),

    tiersKey(server.equipmentTiers),

    lootKey(server.session?.loot ?? []),

    policySyncKey(server),

    [
      server.appearance?.outfit ?? 0,
      server.appearance?.head ?? 0,
      server.appearance?.body ?? 0,
      server.appearance?.legs ?? 0,
      server.appearance?.feet ?? 0,
      server.appearance?.addons ?? 0,
      server.appearance?.mount ?? 0,
      server.appearance?.aura ?? 0,
    ].join(':'),

  ].join(';');

}



function viewEquipmentToState(equipment: CharacterView['equipment']): CharacterState['equipment'] {

  const out: CharacterState['equipment'] = {};

  for (const [slot, item] of Object.entries(equipment)) {

    out[slot as EquipSlot] = item.id;

  }

  return out;

}



function viewTiersToState(tiers: CharacterView['equipmentTiers']): CharacterState['equipmentTiers'] {

  const out: CharacterState['equipmentTiers'] = {};

  for (const [slot, tier] of Object.entries(tiers ?? {})) {

    out[slot as EquipSlot] = tier;

  }

  return out;

}



/**

 * Fill the gap between server snapshots.

 *

 * The socket pushes the real session every couple of seconds. Between those

 * pushes the browser runs the same `advance` the server does, so the viewport

 * and analysers move at tick rate instead of looking frozen. A new snapshot

 * always wins — the client never sends predicted results back.

 */

export function usePredictedCharacter(server: CharacterView): { character: CharacterView; events: SimEvent[] } {

  const local = useRef<HuntSession | null>(cloneLive(server.live));

  const [predicted, setPredicted] = useState(() => overlay(server, local.current));

  const [events, setEvents] = useState<SimEvent[]>([]);

  const serverRef = useRef(server);

  serverRef.current = server;

  const lastServerSyncKey = useRef(inventorySyncKey(server));

  const lastCharacterId = useRef(server.id);

  const serverSyncKey = inventorySyncKey(server);



  useEffect(() => {

    const incoming = server.live;

    const current = local.current;

    const characterChanged = lastCharacterId.current !== server.id;

    lastCharacterId.current = server.id;

    const combatDiverged = Boolean(
      current
      && incoming
      && combatPackDiverged(current, incoming),
    );

    if (

      !characterChanged

      && current

      && incoming

      && incoming.huntId === current.huntId

      && incoming.status === current.status

      && incoming.tick <= current.tick

      && !combatDiverged

    ) {

      applyServerSnapshot(current, server);

      lastServerSyncKey.current = inventorySyncKey(server);

      setPredicted(overlay(serverRef.current, current));

      return;

    }

    local.current = cloneLive(incoming);

    if (local.current) applyServerSnapshot(local.current, server);

    lastServerSyncKey.current = inventorySyncKey(server);

    setPredicted(overlay(server, local.current));

    setEvents([]);

  }, [

    server.id,

    server.live?.huntId,

    server.live?.tick,

    server.live?.status,

    server.health,

    server.mana,

    server.gold,

    serverSyncKey,

  ]);



  useEffect(() => {

    const id = window.setInterval(() => {

      const session = local.current;

      if (!session || session.status !== 'active' || document.hidden) return;

      try {

        const srv = serverRef.current;

        const remoteKey = inventorySyncKey(srv);

        if (remoteKey !== lastServerSyncKey.current) {

          applyServerSnapshot(session, srv);

          lastServerSyncKey.current = remoteKey;

        }

        const produced = advance(session, 1, { maxEvents: 80 });

        setEvents(produced);

        setPredicted(overlay(srv, session));

      } catch (error) {

        console.error('hunt predict', error);

      }

    }, TICK_MS);

    return () => window.clearInterval(id);

  }, [server.id, server.live?.huntId]);



  return { character: predicted, events };

}



function viewPolicyToState(policy: CharacterView['policy']): HuntPolicy {

  return clonePolicy(policy as HuntPolicy);

}



function viewHelperProfilesToState(profiles: CharacterView['helperProfiles']): CharacterState['helperProfiles'] {

  const out: CharacterState['helperProfiles'] = {};

  if (profiles.boss) out.boss = clonePolicy(profiles.boss as HuntPolicy);

  if (profiles.pvp) out.pvp = clonePolicy(profiles.pvp as HuntPolicy);

  return out;

}



/** Manual actions (equip, use/sell potions) update the server snapshot without advancing tick. */

function applyServerSnapshot(session: HuntSession, server: CharacterView): void {

  session.character.health = server.health;

  session.character.mana = server.mana;

  session.character.gold = server.gold;

  session.character.policy = viewPolicyToState(server.policy);

  session.character.helperProfiles = viewHelperProfilesToState(server.helperProfiles ?? {});

  session.character.appearance = {
    outfit: server.appearance.outfit,
    head: server.appearance.head,
    body: server.appearance.body,
    legs: server.appearance.legs,
    feet: server.appearance.feet,
    addons: server.appearance.addons ?? 0,
    mount: server.appearance.mount ?? 0,
    aura: server.appearance.aura ?? 0,
  };

  session.character.unlockedMounts = [...(server.unlockedMounts ?? [])];

  session.character.unlockedOutfits = [...(server.unlockedOutfits ?? [])];

  session.character.supplies = server.supplies.map((stack) => ({

    itemId: stack.itemId,

    count: stack.count,

  }));

  session.character.warehouse = server.warehouse.map((stack) => ({

    itemId: stack.itemId,

    count: stack.count,

  }));

  session.character.backpackContents = (server.backpackContents ?? []).map((stack) => ({

    itemId: stack.itemId,

    count: stack.count,

  }));

  session.character.equipment = viewEquipmentToState(server.equipment);

  session.character.equipmentTiers = viewTiersToState(server.equipmentTiers);

  const lootByItem: Record<number, number> = {};

  for (const stack of server.session?.loot ?? []) {

    lootByItem[stack.itemId] = stack.count;

  }

  session.totals.lootByItem = lootByItem;

  if (server.session?.totals) {

    session.totals.lootValue = server.session.totals.lootValue;

    session.totals.supplyValue = server.session.totals.supplyValue;

  }

  if (server.live?.healCooldownTicks !== undefined) {

    session.healCooldownTicks = server.live.healCooldownTicks;

  }

}



function cloneLive(live: HuntSession | null | undefined): HuntSession | null {

  if (!live || live.status !== 'active') return null;

  return structuredClone(live);

}



function activeUidSet(session: HuntSession): Set<number> {

  return new Set(session.active.map((monster) => monster.uid));

}



/** Server and local packs differ — resync even if the client tick is ahead. */

function combatPackDiverged(current: HuntSession, incoming: HuntSession): boolean {

  if (current.huntId !== incoming.huntId) return false;

  const cur = activeUidSet(current);

  const inc = activeUidSet(incoming);

  if (cur.size !== inc.size) return true;

  for (const uid of inc) {

    if (!cur.has(uid)) return true;

  }

  return false;

}



function overlay(server: CharacterView, session: HuntSession | null): CharacterView {

  if (!session) return { ...server, live: null };



  // Inventory comes from the last server snapshot (equip/sell/move actions).

  // Without this, the local tick loop keeps rendering stale paperdoll slots.

  applyServerSnapshot(session, server);



  const stats = deriveStats(session.character);

  return {

    ...server,

    level: session.character.level,

    experience: session.character.experience,

    health: Math.max(0, Math.round(session.character.health)),

    maxHealth: stats.maxHealth,

    mana: Math.max(0, Math.round(session.character.mana)),

    maxMana: stats.maxMana,

    gold: session.character.gold,

    blessings: session.character.blessings ?? 0,

    soul: session.character.soul ?? 0,

    task: session.character.task ?? null,

    equipment: server.equipment,

    equipmentTiers: { ...(server.equipmentTiers ?? {}) },

    warehouse: server.warehouse,

    backpackContents: server.backpackContents ?? [],

    backpackCapacity: server.backpackCapacity ?? 20,

    stamina: session.character.stamina,

    supplies: server.supplies,

    magicLevel: session.character.magicLevel,

    manaSpent: session.character.manaSpent,

    skills: session.character.skills,

    appearance: session.character.appearance,

    unlockedMounts: session.character.unlockedMounts ?? [],

    unlockedOutfits: session.character.unlockedOutfits ?? [],

    // Always derive the viewport pack from the local tick — server.session lags
    // by ~2s and desyncs uids, so damage floaters never find their sprites.
    session: describeSession(session),

    live: session,

  };

}


