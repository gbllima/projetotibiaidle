import { getMonster, getVocation, hunts, itemsById, recommendedLevelFor } from '@tibia-idle/data';
import {
  activeBoosts, bestLoadout, bossPoints, bossSlotCap, bossCooldownRemainingMs, bossEncounters, bossHuntId,
  calculateBosstiaryLootBonus, charmPointsEarned, charmPointsLeft,   combatProcs, createCharacter,
  combatHitChance, defaultSupplies, deriveStats, normalizeCharacter, normalizeSession,
  estimateDamagePerSecond, expectedExperiencePerHour, huntThroughput,
  loadoutCost, estimatePackHuntSupplies, suppliesCost, throughputFit, wheelPointsEarned, wheelPointsLeft,
  dummySkillName, trainOffline, gearTier, movePouchToWarehouse, addItemStack, backpackCapacity,
  lootSlotUpgradeCost, supplySlotUpgradeCost, lootSlotCoinCost, supplySlotCoinCost,
  LOOT_SLOT_DEFAULT, SUPPLY_SLOT_DEFAULT,
  availableExerciseHits,
  partyExperienceShare, isPromoted,
  expForLevel,
  type CharacterState, type HuntSession, type PartyHunter, type SimEvent,
} from '@tibia-idle/sim';
import { isAdminUsername } from './auth.js';
import type { CharacterRow, Database } from './db.js';
import { beginHunt, endHunt, GameError, regenStamina, requiredPartySlots, settle, summarise } from './settle.js';
import { HUNT_CAP, promoteHunt, releaseAndPromote, tryStartOrQueue } from './queue.js';

/**
 * Game operations on top of the database.
 *
 * Every read settles first. A character's stored state is only ever correct as
 * of `settledAt`, so answering a query without advancing it would report stale
 * progress and let the next write clobber whatever happened in between.
 */

const PLAYABLE_VOCATIONS = [4, 3, 1, 2, 9];
/**
 * Enough to buy starting gear and still stock a first trip. A new character
 * with nothing to spend would have nowhere to go, which is a poor opening for
 * a game whose whole loop is "leave, earn, come back richer".
 */
const STARTING_GOLD = 10_000;
const STARTING_GEAR_BUDGET = 3_000;
export const FREE_CHARACTER_SLOTS = 5;
export const MAX_CHARACTER_SLOTS = 5;

export function characterSlotCap(db: Database, accountId: number): number {
  const extra = Number(db.getWorld(`slots:${accountId}`) ?? 0);
  const bought = Number.isFinite(extra) ? Math.max(0, Math.floor(extra)) : 0;
  return Math.min(MAX_CHARACTER_SLOTS, FREE_CHARACTER_SLOTS + bought);
}

export function buyCharacterSlot(db: Database, accountId: number): number {
  const cap = characterSlotCap(db, accountId);
  if (cap >= MAX_CHARACTER_SLOTS) throw new GameError('Character slots are already maxed.', 409);
  db.setWorld(`slots:${accountId}`, String(cap - FREE_CHARACTER_SLOTS + 1));
  return cap + 1;
}

export interface LoadedCharacter {
  row: CharacterRow;
  character: CharacterState;
  session: HuntSession | null;
  partyEvents?: SimEvent[];
}

function partyKey(ownerId: number): string {
  return `party:${ownerId}`;
}

function storedPartyIds(db: Database, ownerId: number): number[] {
  const raw = db.getWorld(partyKey(ownerId));
  if (!raw) return [ownerId];
  try {
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids)) return [ownerId];
    return [...new Set([ownerId, ...ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)])];
  } catch {
    return [ownerId];
  }
}

export function lobbyPlayers(db: Database): Array<{
  id: number;
  name: string;
  level: number;
  vocationId: number;
  appearance?: CharacterState['appearance'];
  active: boolean;
}> {
  const rows = db.allCharacters();
  const hidden = new Set<number>();
  for (const row of rows) {
    for (const memberId of storedPartyIds(db, row.id).slice(1)) hidden.add(memberId);
  }
  return rows.flatMap((row) => {
    if (hidden.has(row.id)) return [];
    let state: CharacterState;
    let active = false;
    try {
      const session = row.session ? JSON.parse(row.session) as HuntSession : null;
      state = session?.character ?? JSON.parse(row.state) as CharacterState;
      active = session?.status === 'active';
    } catch {
      return [];
    }
    return [{
      id: row.id,
      name: state.name,
      level: state.level,
      vocationId: state.vocationId,
      appearance: state.appearance,
      active,
    }];
  });
}

export function canManageActivePartyMember(db: Database, accountId: number, ownerId: number, memberId: number): boolean {
  if (memberId === ownerId) return true;
  const owner = loadCharacter(db, accountId, ownerId).loaded;
  if (!owner.session || owner.session.status !== 'active') return false;
  if (!storedPartyIds(db, ownerId).includes(memberId)) return false;
  return db.listHuntHunters(owner.session.huntId).some((hunter) => hunter.id === memberId);
}

export function addPartyMember(db: Database, accountId: number, ownerId: number, memberId: number): void {
  const owner = loadCharacter(db, accountId, ownerId).loaded;
  const memberRow = db.findCharacter(memberId);
  if (!memberRow || memberRow.accountId !== accountId) throw new GameError('Personagem inválido.', 404);
  if (memberId === ownerId) throw new GameError('Você já está na party.', 409);
  const ids = storedPartyIds(db, ownerId);
  if (ids.includes(memberId)) return;
  if (ids.length >= (owner.character.partySlots ?? 1)) throw new GameError('A party está cheia.', 409);
  const member = loadCharacter(db, accountId, memberId).loaded;
  owner.character.backpackContents ??= [];
  owner.character.warehouse ??= [];
  member.character.backpackContents ??= [];
  member.character.warehouse ??= [];
  for (const stack of member.character.backpackContents.filter((entry) => entry.count > 0)) {
    const existing = owner.character.backpackContents.find((entry) => entry.itemId === stack.itemId);
    if (existing || owner.character.backpackContents.length < backpackCapacity(owner.character)) {
      addItemStack(owner.character.backpackContents, stack.itemId, stack.count);
    } else {
      addItemStack(owner.character.warehouse, stack.itemId, stack.count);
    }
  }
  member.character.backpackContents = [];
  persist(db, owner, Date.now());
  persist(db, member, Date.now());
  db.setWorld(partyKey(ownerId), JSON.stringify([...ids, memberId]));
}

export function removePartyMember(db: Database, accountId: number, ownerId: number, memberId: number): void {
  loadCharacter(db, accountId, ownerId);
  const ids = storedPartyIds(db, ownerId);
  if (memberId === ownerId) throw new GameError('O líder não pode ser removido.', 409);
  db.setWorld(partyKey(ownerId), JSON.stringify(ids.filter((id) => id !== memberId)));
}

function parse(row: CharacterRow): LoadedCharacter {
  const session = row.session ? (JSON.parse(row.session) as HuntSession) : null;
  // While hunting, the session owns the character: the simulation mutates it
  // in place, and the copy in `state` is a stale snapshot.
  const character = session ? session.character : (JSON.parse(row.state) as CharacterState);
  normalizeCharacter(character);
  if (session) {
    normalizeSession(session);
    normalizeCharacter(session.character);
  }
  return { row, character, session };
}

function attachCaveParty(db: Database, loaded: LoadedCharacter): void {
  if (!loaded.session) return;
  loaded.session.partyMembers = db
    .listHuntHunters(loaded.session.huntId)
    .filter((hunter) => hunter.id !== loaded.row.id)
    .map((hunter) => ({
      ...hunter,
      appearance: hunter.appearance
        ? { ...hunter.appearance, addons: hunter.appearance.addons ?? 0 }
        : undefined,
    }));
}

function cavePartyView(loaded: LoadedCharacter): Array<PartyHunter & { self: boolean }> {
  const self: PartyHunter & { self: boolean } = {
    id: loaded.row.id,
    name: loaded.character.name,
    level: loaded.character.level,
    vocationId: loaded.character.vocationId,
    appearance: loaded.character.appearance,
    self: true,
  };
  const others = (loaded.session?.partyMembers ?? []).map((hunter) => ({ ...hunter, self: false }));
  return [self, ...others];
}

function persistentPartyView(loaded: LoadedCharacter, db: Database): Array<PartyHunter & { self: boolean }> {
  if (db.getWorld(partyKey(loaded.row.id)) === null) return cavePartyView(loaded);
  loaded.character.backpackContents ??= [];
  loaded.character.warehouse ??= [];
  let ownerChanged = false;
  for (const memberId of storedPartyIds(db, loaded.row.id).filter((id) => id !== loaded.row.id)) {
    const member = loadCharacter(db, loaded.row.accountId, memberId).loaded;
    member.character.backpackContents ??= [];
    let changed = false;
    for (const stack of member.character.backpackContents.filter((entry) => entry.count > 0)) {
      const existing = loaded.character.backpackContents.find((entry) => entry.itemId === stack.itemId);
      if (existing || loaded.character.backpackContents.length < backpackCapacity(loaded.character)) {
        addItemStack(loaded.character.backpackContents, stack.itemId, stack.count);
      } else {
        loaded.character.warehouse.push({ itemId: stack.itemId, count: stack.count });
      }
      ownerChanged = true;
      changed = true;
    }
    if (changed) {
      member.character.backpackContents = [];
      persist(db, member, Date.now());
    }
  }
  if (ownerChanged) persist(db, loaded, Date.now());
  const activeIds = new Set(
    loaded.session?.status === 'active'
      ? db.listHuntHunters(loaded.session.huntId).map((hunter) => hunter.id)
      : [],
  );
  const sharedBackpack = (loaded.character.backpackContents ?? []).filter((stack) => stack.count > 0);
  const sharedBackpackCapacity = backpackCapacity(loaded.character);
  return storedPartyIds(db, loaded.row.id).flatMap((id) => {
    const member = id === loaded.row.id ? loaded : loadCharacter(db, loaded.row.accountId, id).loaded;
    if (!member) return [];
    const stats = deriveStats(member.character);
    return [{
      id,
      name: member.character.name,
      level: member.character.level,
      experience: member.character.experience,
      health: Math.max(0, Math.round(member.character.health)),
      maxHealth: stats.maxHealth,
      mana: Math.max(0, Math.round(member.character.mana)),
      maxMana: stats.maxMana,
      vocationId: member.character.vocationId,
      appearance: member.character.appearance,
      policy: member.character.policy,
      equipment: Object.fromEntries(
        Object.entries(member.character.equipment).map(([slot, itemId]) => [
          slot,
          { id: itemId, name: itemsById.get(itemId as number)?.name ?? 'unknown' },
        ]),
      ),
      backpackContents: sharedBackpack.map((stack) => ({
        itemId: stack.itemId,
        name: itemsById.get(stack.itemId)?.name ?? 'item',
        count: stack.count,
      })),
      backpackCapacity: sharedBackpackCapacity,
      active: id === loaded.row.id
        ? loaded.session?.status === 'active'
        : activeIds.has(id)
          || (member.session?.status === 'active' && member.session.huntId === loaded.session?.huntId),
      self: id === loaded.row.id,
    }];
  });
}

function persist(db: Database, loaded: LoadedCharacter, now: number): void {
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
}

interface PartyXpEntry {
  loaded: LoadedCharacter;
  beforeExperience: number;
  beforeSessionExperience: number;
  events: SimEvent[];
}

function settleActivePartyMembers(db: Database, ownerId: number, huntId: string, now: number): PartyXpEntry[] {
  const entries: PartyXpEntry[] = [];
  for (const memberId of storedPartyIds(db, ownerId).filter((id) => id !== ownerId)) {
    const row = db.findCharacter(memberId);
    if (!row) continue;
    try {
      const member = parse(row);
      const beforeExperience = member.character.experience;
      if (member.session?.status === 'active' && member.session.huntId === huntId) {
        const beforeSessionExperience = member.session.totals.experience;
        const settlement = settle(member.session, row.settledAt, now);
        if (settlement.session.status !== 'active') {
          endHunt(settlement.session);
          member.character = settlement.session.character;
          member.session = null;
          persist(db, member, now);
          releaseAndPromote(db, memberId, now);
        } else {
          member.character = settlement.session.character;
          entries.push({
            loaded: member,
            beforeExperience,
            beforeSessionExperience,
            events: settlement.events,
          });
        }
      } else {
        entries.push({ loaded: member, beforeExperience, beforeSessionExperience: 0, events: [] });
      }
    } catch (error) {
      console.error('settle party member', memberId, error);
    }
  }
  return entries;
}

function rebalancePartyExperience(entries: PartyXpEntry[], now: number, db: Database): void {
  if (entries.length < 2) return;
  const gained = entries.map((entry) => entry.loaded.character.experience - entry.beforeExperience);
  const shared = Math.floor(gained.reduce((sum, amount) => sum + amount, 0) / entries.length);
  entries.forEach((entry) => {
    const character = entry.loaded.character;
    character.experience = entry.beforeExperience + shared;
    while (character.level > 8 && character.experience < expForLevel(character.level)) character.level -= 1;
    while (character.experience >= expForLevel(character.level + 1)) character.level += 1;
    if (entry.loaded.session) {
      entry.loaded.session.totals.experience = entry.beforeSessionExperience + shared;
    }
    const stats = deriveStats(character);
    character.health = Math.min(character.health, stats.maxHealth);
    character.mana = Math.min(character.mana, stats.maxMana);
    persist(db, entry.loaded, now);
  });
}

/**
 * Settle every stored hunt and drop ghost occupancy.
 * Call on boot (and optionally on a timer) so abandoned test characters
 * do not stay in caves forever after a server restart.
 */
export function reconcileHunts(db: Database, now = Date.now()): { settled: number; orphans: number } {
  let settled = 0;
  let orphans = 0;

  for (const row of db.allCharacters()) {
    if (!row.session) continue;
    try {
      const loaded = parse(row);
      if (!loaded.session) continue;
      const settlement = settle(loaded.session, row.settledAt, now);
      if (settlement.session && settlement.session.status !== 'active') {
        endHunt(settlement.session);
        loaded.character = settlement.session.character;
        loaded.session = null;
        persist(db, loaded, now);
        releaseAndPromote(db, row.id, now);
        settled += 1;
      } else if (settlement.session && settlement.elapsedSeconds > 0) {
        loaded.session = settlement.session;
        loaded.character = settlement.session.character;
        persist(db, loaded, now);
      }
    } catch (error) {
      console.error('reconcile settle', row.id, error);
    }
  }

  const touchedHunts = new Set<string>();
  for (const entry of db.listAllOccupancy()) {
    const row = db.findCharacter(entry.characterId);
    let keep = false;
    if (row?.session) {
      try {
        const session = JSON.parse(row.session) as { status?: string; huntId?: string };
        keep = session.status === 'active' && session.huntId === entry.huntId;
      } catch {
        keep = false;
      }
    }
    if (!keep) {
      db.releaseHunt(entry.characterId);
      touchedHunts.add(entry.huntId);
      orphans += 1;
    }
  }

  for (const huntId of touchedHunts) {
    promoteHunt(db, huntId, now);
  }

  if (settled || orphans) {
    console.log(`hunt reconcile: settled=${settled} orphans=${orphans}`);
  }
  return { settled, orphans };
}

export function createNewCharacter(
  db: Database,
  accountId: number,
  name: string,
  vocationId: number,
  options: { gender?: 'm' | 'f'; weapon?: 'axe' | 'sword' | 'club' } = {},
): LoadedCharacter {
  if (!/^[a-zA-Z][a-zA-Z ']{2,19}$/.test(name)) {
    throw new GameError('Names are 3-20 characters and start with a letter.');
  }
  if (!PLAYABLE_VOCATIONS.includes(vocationId)) {
    throw new GameError('Pick one of the five starting vocations.');
  }
  if (db.findCharacterByName(name)) {
    throw new GameError('That name is taken.', 409);
  }
  const cap = characterSlotCap(db, accountId);
  if (db.charactersForAccount(accountId).length >= cap) {
    throw new GameError(`An account holds at most ${cap} characters.`, 409);
  }

  const character = createCharacter(name, vocationId);
  character.gender = options.gender === 'f' ? 'f' : 'm';
  character.startWeapon = options.weapon === 'axe' || options.weapon === 'club' ? options.weapon : 'sword';
  if (vocationId === 4) {
    character.skills[character.startWeapon].level = 12;
  }
  character.gold = STARTING_GOLD;
  character.equipment = bestLoadout(character, STARTING_GEAR_BUDGET);
  character.gold -= loadoutCost(character.equipment);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;

  const row = db.createCharacter(accountId, name, vocationId, JSON.stringify(character));
  return { row, character, session: null };
}

/** Load a character, settling elapsed time first. */
export function loadCharacter(
  db: Database,
  accountId: number,
  characterId: number,
  now = Date.now(),
): { loaded: LoadedCharacter; settlement: ReturnType<typeof settle> } {
  const row = db.findCharacter(characterId);
  if (!row || row.accountId !== accountId) throw new GameError('No such character.', 404);

  const loaded = parse(row);
  attachCaveParty(db, loaded);
  const settlement = settle(loaded.session, row.settledAt, now);
  if (loaded.session?.status === 'active') {
    const partyEntries: PartyXpEntry[] = [];
    if (settlement.session?.status === 'active' && settlement.elapsedSeconds > 0) {
      partyEntries.push({
        loaded,
        beforeExperience: loaded.character.experience - settlement.delta.experience,
        beforeSessionExperience: loaded.session.totals.experience - settlement.delta.experience,
        events: settlement.events,
      });
    }
    partyEntries.push(...settleActivePartyMembers(db, characterId, loaded.session.huntId, now));
    const targetUid = loaded.session.active[0]?.uid;
    loaded.partyEvents = partyEntries.flatMap((entry) => entry.events
      .filter((event) => event.type === 'player_attack' || event.type === 'monster_attack' || event.type === 'condition' || event.type === 'buff')
      .slice(-24)
      .map((event) => ({ ...event, actorId: entry.loaded.row.id, uid: targetUid ?? event.uid })));
    rebalancePartyExperience(partyEntries, now, db);
  }

  if (settlement.session && settlement.session.status !== 'active') {
    // The hunt ended while the player was away: bank the loot so the gold is
    // waiting for them rather than trapped in a dead session.
    endHunt(settlement.session);
    loaded.character = settlement.session.character;
    loaded.session = null;
    releaseAndPromote(db, characterId, now);
  }

  if (!loaded.session) {
    const waiting = db.queuedHunt(characterId);
    if (waiting && db.huntOccupancy(waiting.huntId) < HUNT_CAP) {
      promoteHunt(db, waiting.huntId, now);
      const refreshed = parse(db.findCharacter(characterId)!);
      attachCaveParty(db, refreshed);
      loaded.character = refreshed.character;
      loaded.session = refreshed.session;
    }
  }

  if (!loaded.session) {
    regenStamina(loaded.character, now - row.settledAt);
    trainOffline(loaded.character, now - row.settledAt);
  }

  if (settlement.elapsedSeconds > 0 || loaded.session === null) {
    persist(db, loaded, now);
  }
  return { loaded, settlement };
}

export function startHunt(
  db: Database,
  accountId: number,
  characterId: number,
  huntId: string,
  now = Date.now(),
  hours?: number,
): LoadedCharacter {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  if (loaded.session?.huntId === huntId) {
    throw new GameError('That character is already hunting.', 409);
  }

  // Clicking another cave while hunting (or queued) switches: bank the current
  // trip, refund leftover potions, then buy a pack for the new spot.
  if (loaded.session) {
    endHunt(loaded.session);
    loaded.character = loaded.session.character;
    loaded.session = null;
    persist(db, loaded, now);
    releaseAndPromote(db, characterId, now);
  } else if (db.queuedHunt(characterId)) {
    db.dequeueHunt(characterId);
    persist(db, loaded, now);
  }

  tryStartOrQueue(db, loaded, huntId, now, hours);
  return loaded;
}

export function stopHunt(
  db: Database,
  accountId: number,
  characterId: number,
  now = Date.now(),
): { loaded: LoadedCharacter; gold: number; refund: number } {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  if (!loaded.session) {
    if (db.queuedHunt(characterId)) {
      db.dequeueHunt(characterId);
      persist(db, loaded, now);
      return { loaded, gold: 0, refund: 0 };
    }
    throw new GameError('That character is not hunting.', 409);
  }

  const { gold, refund } = endHunt(loaded.session);
  loaded.character = loaded.session.character;
  loaded.session = null;
  persist(db, loaded, now);
  releaseAndPromote(db, characterId, now);
  return { loaded, gold, refund };
}

/** Buy the best gear the character can afford, in one action. */
export function upgradeGear(
  db: Database,
  accountId: number,
  characterId: number,
  now = Date.now(),
): { loaded: LoadedCharacter; spent: number } {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  if (loaded.session) throw new GameError('Finish the hunt before changing gear.', 409);

  const current = loadoutCost(loaded.character.equipment);
  const budget = current + loaded.character.gold;
  const target = bestLoadout(loaded.character, budget);
  const spent = Math.max(0, loadoutCost(target) - current);

  if (spent > loaded.character.gold) throw new GameError('Not enough gold.', 402);

  const previous = { ...loaded.character.equipment };
  loaded.character.equipment = target;
  loaded.character.gold -= spent;
  loaded.character.warehouse ??= [];
  for (const [slot, itemId] of Object.entries(previous)) {
    if (itemId === undefined) continue;
    if (loaded.character.equipment[slot as keyof typeof loaded.character.equipment] === itemId) continue;
    addItemStack(loaded.character.warehouse, itemId, 1);
    if (loaded.character.equipmentTiers?.[slot as keyof typeof loaded.character.equipmentTiers]) {
      delete loaded.character.equipmentTiers[slot as keyof typeof loaded.character.equipmentTiers];
    }
  }

  const stats = deriveStats(loaded.character);
  loaded.character.health = Math.min(loaded.character.health, stats.maxHealth);
  loaded.character.mana = Math.min(loaded.character.mana, stats.maxMana);

  persist(db, loaded, now);
  return { loaded, spent };
}

/** Sell everything currently in the loot pouch without ending the hunt. */
export function sellPouch(
  db: Database,
  accountId: number,
  characterId: number,
  now = Date.now(),
): { loaded: LoadedCharacter; gold: number } {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  if (!loaded.session) throw new GameError('You are not hunting.', 409);

  let gold = 0;
  for (const [id, count] of Object.entries(loaded.session.totals.lootByItem)) {
    gold += (itemsById.get(Number(id))?.sellPrice ?? 0) * count;
  }
  loaded.session.totals.lootByItem = {};
  loaded.session.character.gold += gold;
  loaded.character.gold = loaded.session.character.gold;
  persist(db, loaded, now);
  return { loaded, gold };
}

/** Send pouch items to the warehouse without selling them. */
export function stashPouch(
  db: Database,
  accountId: number,
  characterId: number,
  now = Date.now(),
): { loaded: LoadedCharacter; items: number } {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  if (!loaded.session) throw new GameError('You are not hunting.', 409);

  const items = movePouchToWarehouse(loaded.session);
  loaded.character.warehouse = loaded.session.character.warehouse;
  persist(db, loaded, now);
  return { loaded, items };
}

/** Character view for the client. */
export function describeCharacter(loaded: LoadedCharacter, db?: Database) {
  if (db) attachCaveParty(db, loaded);
  const { character } = loaded;
  const stats = deriveStats(character);
  const vocation = getVocation(character.vocationId);
  const partyLevels = (loaded.session?.partyMembers ?? []).map((hunter) => hunter.level);
  const partyShare = partyExperienceShare(partyLevels, character.level, character.partySlots ?? 1);
  const affordableTrip = estimatePackHuntSupplies(character, 1);

  return {
    id: loaded.row.id,
    name: character.name,
    vocation: { id: vocation.id, name: vocation.name },
    level: character.level,
    experience: character.experience,
    health: Math.max(0, Math.round(character.health)),
    maxHealth: stats.maxHealth,
    mana: Math.max(0, Math.round(character.mana)),
    maxMana: stats.maxMana,
    magicLevel: character.magicLevel,
    manaSpent: character.manaSpent ?? 0,
    skills: character.skills,
    gold: character.gold,
    canAffordTrip: affordableTrip.supplies.length > 0 && affordableTrip.cost <= character.gold,
    affordableTripCost: affordableTrip.cost,
    blessings: character.blessings ?? 0,
    soul: character.soul ?? 0,
    soulMax: vocation.soulMax,
    harmony: character.harmony ?? 0,
    virtueHarmony: character.virtueHarmony ?? false,
    promoted: isPromoted(character.vocationId),
    task: character.task ?? null,
    lastHuntId: character.lastHuntId ?? null,
    stamina: character.stamina,
    premium: character.premium,
    equipment: Object.fromEntries(
      Object.entries(character.equipment).map(([slot, id]) => [
        slot,
        { id, name: itemsById.get(id as number)?.name ?? 'unknown' },
      ]),
    ),
    supplies: character.supplies.map((stack) => ({
      itemId: stack.itemId,
      name: itemsById.get(stack.itemId)?.name ?? 'unknown',
      count: stack.count,
    })),
    stats: {
      attackValue: stats.attackValue,
      attackSkill: stats.attackSkill,
      attackSkillName: stats.attackSkillName,
      defense: Math.round(stats.defense),
      armor: stats.armor,
      mitigation: stats.mitigation,
      capacity: stats.capacity,
      damagePerSecond: Math.round(estimateDamagePerSecond(character, 3)),
    },
    procs: (() => {
      const procs = combatProcs(character);
      const hitChance = combatHitChance(character, stats);
      return {
        critChance: Math.round(procs.critChance) / 100,
        critExtra: Math.round(procs.critExtra) / 100,
        lifeLeech: Math.round(procs.lifeLeech) / 100,
        manaLeech: Math.round(procs.manaLeech) / 100,
        dodgeChance: Math.round(procs.dodgeChance * 10) / 10,
        onslaughtChance: Math.round(procs.onslaughtChance * 10) / 10,
        momentumChance: Math.round(procs.momentumChance * 10) / 10,
        transcendenceChance: Math.round(procs.transcendenceChance * 100) / 100,
        amplificationPercent: Math.round(procs.amplificationPercent * 10) / 10,
        magicLevel: procs.magicLevel,
        hitChance: hitChance === null ? undefined : Math.round(hitChance * 10) / 10,
      };
    })(),
    session: summarise(loaded.session),
    live: loaded.session && loaded.session.status === 'active' ? loaded.session : null,
    bestiary: character.bestiary ?? {},
    coins: character.coins ?? 0,
    vipUntil: character.vipUntil ?? 0,
    gender: character.gender ?? 'm',
    warehouse: (character.warehouse ?? []).map((stack) => ({
      itemId: stack.itemId,
      name: itemsById.get(stack.itemId)?.name ?? 'item',
      count: stack.count,
    })),
    backpackContents: (character.backpackContents ?? []).map((stack) => ({
      itemId: stack.itemId,
      name: itemsById.get(stack.itemId)?.name ?? 'item',
      count: stack.count,
    })),
    backpackCapacity: backpackCapacity(character),
    charmsUnlocked: character.charmsUnlocked ?? [],
    charmBinds: character.charmBinds ?? [],
    prey: character.prey ?? [],
    preyWildcards: character.preyWildcards ?? character.preyRerolls ?? 0,
    preyRerolls: character.preyRerolls ?? 0,
    imbuements: character.imbuements ?? [],
    forge: character.forge ?? {},
    forgeDust: character.forgeDust ?? 0,
    forgeDustLevel: character.forgeDustLevel ?? 100,
    forgeSlivers: character.forgeSlivers ?? 0,
    forgeCores: character.forgeCores ?? 0,
    equipmentTiers: Object.fromEntries(
      (['head', 'necklace', 'backpack', 'armor', 'right', 'left', 'legs', 'feet', 'ring', 'ammo'] as const)
        .filter((slot) => character.equipment[slot])
        .map((slot) => [slot, gearTier(character, slot)]),
    ),
    helperProfiles: character.helperProfiles ?? {},
    dailyClaim: character.dailyClaim ?? '',
    dailyStreak: character.dailyStreak ?? 0,
    xpBoostUntil: character.xpBoostUntil ?? 0,
    storeBoosts: {
      xp: { until: character.storeXpBoostUntil ?? 0, bonus: character.storeXpBoostBonus ?? 0 },
      loot: { until: character.storeLootBoostUntil ?? 0, bonus: character.storeLootBoostBonus ?? 0 },
      gold: { until: character.storeGoldBoostUntil ?? 0, bonus: character.storeGoldBoostBonus ?? 0 },
    },
    unlockedOutfits: character.unlockedOutfits ?? [character.appearance.outfit],
    unlockedMounts: character.unlockedMounts ?? [],
    appearance: character.appearance,
    partySlots: character.partySlots ?? 1,
    partyBonus: Math.round((partyShare - 1) * 100),
    caveParty: db ? persistentPartyView(loaded, db) : cavePartyView(loaded),
    guildId: character.guildId,
    decorations: character.decorations ?? [],
    lastDummyTries: character.lastDummyTries ?? 0,
    dummySkill: dummySkillName(character),
    exerciseCharges: availableExerciseHits(character, dummySkillName(character)),
    arenaWins: character.arenaWins ?? 0,
    arenaLosses: character.arenaLosses ?? 0,
    lootSlots: character.lootSlots ?? LOOT_SLOT_DEFAULT,
    lootSlotCost: lootSlotUpgradeCost(character.lootSlots ?? LOOT_SLOT_DEFAULT),
    lootSlotCoinCost: lootSlotCoinCost(character.lootSlots ?? LOOT_SLOT_DEFAULT),
    supplySlots: character.supplySlots ?? SUPPLY_SLOT_DEFAULT,
    supplySlotCost: supplySlotUpgradeCost(character.supplySlots ?? SUPPLY_SLOT_DEFAULT),
    supplySlotCoinCost: supplySlotCoinCost(character.supplySlots ?? SUPPLY_SLOT_DEFAULT),
    appearancePresets: character.appearancePresets ?? [],
    boosts: activeBoosts(character, Date.now(), partyLevels),
    charmPoints: charmPointsEarned(character),
    charmPointsLeft: charmPointsLeft(character),
    onboardingStep: character.onboardingStep ?? 0,
    policy: character.policy,
    queue: db?.queuedHunt(loaded.row.id) ?? null,
    wheel: character.wheel ?? {},
    wheelPoints: wheelPointsEarned(character.level),
    wheelLeft: wheelPointsLeft(character),
    bosstiary: character.bosstiary ?? {},
    bossSlots: character.bossSlots ?? [],
    bossPoints: bossPoints(character.bosstiary),
    bossSlotCap: bossSlotCap(character.bosstiary),
    bossLootBonus: calculateBosstiaryLootBonus(bossPoints(character.bosstiary)),
    admin: Boolean(db && (() => {
      const account = db.findAccountById(loaded.row.accountId);
      return account ? isAdminUsername(account.username) : false;
    })()),
  };
}

/** Hunt list, annotated for this character. */
export function listHunts(character: CharacterState, db?: Database) {
  const dps = estimateDamagePerSecond(character, 3);
  const used = db?.occupancyByHunt() ?? {};
  const queued = db?.queueByHunt() ?? {};

  const listed = hunts.map((hunt) => {
    const throughput = huntThroughput(hunt.id);
    const required = recommendedLevelFor(hunt.id, character.vocationId);
    const fit = throughputFit(hunt.id, dps);
    const supplyCost = suppliesCost(defaultSupplies(character, 1));
    const profitPerHour = hunt.expectedLootPerHour - supplyCost;

    return {
      id: hunt.id,
      name: hunt.name,
      location: hunt.location,
      statedLevel: hunt.level,
      recommendedLevel: required,
      unlocked: required !== null && character.level >= Math.floor(required / 2),
      expectedXpPerHour: expectedExperiencePerHour(hunt.id),
      estimatedRate: throughput.estimated,
      expectedLootPerHour: hunt.expectedLootPerHour,
      packSize: throughput.packSize,
      monsters: hunt.monsters,
      premium: hunt.premium,
      /** 0-1: how much of the zone's spawn budget this character could use. */
      fit: Math.round(fit * 100) / 100,
      supplyCost,
      profitPerHour: Math.round(profitPerHour),
      slots: { used: used[hunt.id] ?? 0, cap: HUNT_CAP, queued: queued[hunt.id] ?? 0 },
      partySizes: hunt.partySizes,
      partyNeed: requiredPartySlots(hunt.partySizes),
      partyLocked: (character.partySlots ?? 1) < requiredPartySlots(hunt.partySizes),
      recommended: false,
    };
  });
  const best = bestHuntFor(listed);
  return listed.map((hunt) => ({ ...hunt, recommended: hunt.id === best }));
}

function bestHuntFor(hunts: Array<{
  id: string;
  unlocked: boolean;
  partyLocked: boolean;
  fit: number;
  profitPerHour: number;
  expectedXpPerHour: number;
}>): string | null {
  let bestId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const hunt of hunts) {
    if (!hunt.unlocked || hunt.partyLocked) continue;
    const fit = Math.max(0.15, hunt.fit);
    const score = hunt.profitPerHour * fit + hunt.expectedXpPerHour * 0.02 * fit;
    if (score > bestScore) {
      bestScore = score;
      bestId = hunt.id;
    }
  }
  return bestId;
}

/** Boss / raid / event lever list for the hunt teleport UI. */
export function listBosses(character: CharacterState, now = Date.now()) {
  return bossEncounters.map((entry) => {
    const monster = getMonster(entry.monsterId);
    const cooldownMs = bossCooldownRemainingMs(character, entry.id, now);
    return {
      id: entry.id,
      huntId: bossHuntId(entry.id),
      name: monster.name,
      monsterId: entry.monsterId,
      category: entry.category,
      location: entry.location,
      minLevel: entry.minLevel,
      description: entry.description,
      experience: monster.experience,
      health: monster.health,
      unlocked: character.level >= Math.floor(entry.minLevel / 2),
      onCooldown: cooldownMs > 0,
      cooldownUntil: character.bossCooldowns?.[entry.id] ?? 0,
      cooldownRemainingMs: cooldownMs,
    };
  });
}
