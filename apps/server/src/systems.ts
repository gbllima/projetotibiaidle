import {
  charms, hunts, itemsById, itemsByName, monstersById, outfitsCatalog,
} from '@tibia-idle/data';
import {
  bossPoints, bossSlotCap, bossStage, charmPointsEarned, charmPointsLeft, COIN_PACKS, DAILY_XP_BOOST_MS, DECORATIONS, deriveStats,
  emptyPreySlot, estimateDamagePerSecond, getWorldEvent, GOLD_PER_COIN, GUILD_COST, IMBUEMENTS,
  imbueReagentsFor, IMBUEMENT_DURATION_MS, itemImbuementSlots, nextImbueIndex,
  LOOT_SLOT_CAP, LOOT_SLOT_DEFAULT, LOOT_SLOT_STEP, lootSlotUpgradeCost, lootSlotCoinCost,
  SUPPLY_SLOT_CAP, SUPPLY_SLOT_STEP, supplySlotUpgradeCost, supplySlotCoinCost, MARKET_CATALOG, isMarketItem, marketBuyPrice, PARTY_SLOT_COINS, PARTY_SLOT_GOLD,
  PRESET_CAP, PREY_DURATION_MS, PREY_WILDCARD_AUTO_BONUS, PREY_WILDCARD_LOCK, PREY_WILDCARD_PICK,
  activatePreyMonster, ensurePreySlots, isPreyActive, isPreySelecting, preyListRerollGold, preyPool,
  preySlotCount, preyWildcards, rerollPreyList, rollPreyBonusReroll, syncPreyWildcards,
  IMBUEMENT_CLEAR_COST,
  SHOP,
  applyStoreBoost, ownsShopMount, ownsShopOutfit, ownsShopOutfitOffer, unlockOutfitOffer, outfitMatchesGender,
  HEAL_SPELLS, SPELLS, TUTORIAL_HUNT_ID, VIP_DURATION_MS, WHEEL_NODES, WHEEL_RANK_CAP, WHEEL_UNLOCK_LEVEL, wheelPointsLeft,
  BLESSING_CAP, BLESSING_BITS, blessingCost, buyAllBlessingsCost, hasBlessing, missingBlessingIndices, normalizeBlessingMask, TASK_SKIP_GOLD, makeHuntTask,
  clonePolicy, wearItem, removeWorn, exaltSlot, convergenceFuseSlot, transferSlotTier, policyForMode, runeById, slotFor,
  acquireItemStacks, isConsumableItem, moveStackToBackpack, moveStackToSupply, backpackCapacity,
  DEFAULT_POLICY,
  promoteCharacter, dailyBoostedMonster, raiseForgeDustCap, convertDustToSlivers, convertSliversToCore,
  FORGE_FUSION_DUST_COST, FORGE_DUST_PER_SLIVER_PACK, FORGE_SLIVERS_PER_PACK, FORGE_SLIVERS_PER_CORE,
  useConsumableItem,
  supplyUnitCost,
  trainOnline, onlineTrainIntervalMs,
  warehouseHasRoom,
  Rng,
  ROULETTE_SPIN_COST,
  spinRoulette,
  roulettePool,
  TICK_MS,
  type CharacterState, type EquipSlot, type HelperMode, type PreyBonus,
} from '@tibia-idle/sim';
import type { Database } from './db.js';
import { buyCharacterSlot, canManageActivePartyMember, characterSlotCap, listHunts, loadCharacter, MAX_CHARACTER_SLOTS, type LoadedCharacter } from './game.js';
import { onlineCharacterIds } from './presence.js';
import { GameError } from './settle.js';
import { tryStartOrQueue } from './queue.js';

const PREY_BONUSES: PreyBonus[] = ['damage', 'defense', 'experience', 'loot'];

function preySlotIndex(character: CharacterState, slot: number, now: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= preySlotCount(character, now)) {
    throw new GameError('Invalid prey slot.');
  }
  ensurePreySlots(character, now);
  return slot;
}

function preyExcludeMonsters(character: CharacterState, slotIndex: number): string[] {
  return character.prey
    .map((entry, index) => (index === slotIndex ? null : entry.monsterId))
    .filter(Boolean) as string[];
}
const HEAL_EXHAUST_MS = 1000;
const HEAL_EXHAUST_TICKS = Math.max(1, Math.round(HEAL_EXHAUST_MS / TICK_MS));

function combatSkill(state: CharacterState): number {
  const skills = state.skills ?? {};
  return Math.max(
    state.magicLevel ?? 0,
    skills.sword?.level ?? 0,
    skills.axe?.level ?? 0,
    skills.club?.level ?? 0,
    skills.distance?.level ?? 0,
    skills.fist?.level ?? 0,
    skills.shield?.level ?? 0,
  );
}

function persist(db: Database, loaded: LoadedCharacter, now: number): void {
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
  loaded.row.vocationId = loaded.character.vocationId;
}

function requireIdle(loaded: LoadedCharacter): void {
  if (loaded.session) throw new GameError('Finish the hunt first.', 409);
}

function takeStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (!stack || stack.count < count) throw new GameError('You do not have that item.', 400);
  stack.count -= count;
  if (stack.count <= 0) {
    const index = list.indexOf(stack);
    if (index >= 0) list.splice(index, 1);
  }
}

function addStack(list: Array<{ itemId: number; count: number }>, itemId: number, count: number): void {
  const stack = list.find((entry) => entry.itemId === itemId);
  if (stack) stack.count += count;
  else list.push({ itemId, count });
}

function spendPreyListReroll(character: CharacterState, slotIndex: number, now: number): void {
  const slot = character.prey[slotIndex]!;
  if (isPreyActive(slot, now)) throw new GameError('Finish or wait for the active prey first.', 409);
  if (slot.listRerollAt <= now) return;
  const cost = preyListRerollGold(character.level);
  if (character.gold < cost) throw new GameError(`Need ${cost} gold for a list reroll.`, 402);
  character.gold -= cost;
}

function patchCharacterGuild(db: Database, characterId: number, guildId: number | null, now: number): void {
  const row = db.findCharacter(characterId);
  if (!row) return;
  const state = JSON.parse(row.state) as CharacterState;
  state.guildId = guildId;
  let sessionJson = row.session;
  if (sessionJson) {
    const session = JSON.parse(sessionJson) as { character?: CharacterState };
    if (session.character) session.character.guildId = guildId;
    sessionJson = JSON.stringify(session);
  }
  db.saveCharacter(row.id, JSON.stringify(state), sessionJson, now);
}

function creditSeller(db: Database, sellerId: number, gold: number, coins: number, now: number): void {
  const row = db.findCharacter(sellerId);
  if (!row) return;
  const state = JSON.parse(row.state) as CharacterState;
  state.gold = (state.gold ?? 0) + gold;
  state.coins = (state.coins ?? 0) + coins;
  db.saveCharacter(row.id, JSON.stringify(state), row.session, now);
}

export type ActBody = {
  targetCharacterId?: unknown;
  convergence?: unknown;
  target?: unknown;
  outfit?: unknown;
  head?: unknown;
  legs?: unknown;
  feet?: unknown;
  addons?: unknown;
  mount?: unknown;
  aura?: unknown;
  kind?: unknown;
  id?: unknown;
  buyAll?: unknown;
  blessIndex?: unknown;
  elapsedMs?: unknown;
  type?: unknown;
  slot?: unknown;
  charmId?: unknown;
  monsterId?: unknown;
  imbue?: unknown;
  tier?: unknown;
  sku?: unknown;
  gold?: unknown;
  itemId?: unknown;
  count?: unknown;
  price?: unknown;
  currency?: unknown;
  listingId?: unknown;
  name?: unknown;
  guildId?: unknown;
  characterId?: unknown;
  decoration?: unknown;
  defenderId?: unknown;
  channel?: unknown;
  body?: unknown;
  huntId?: unknown;
  step?: unknown;
  healthPotionAt?: unknown;
  manaPotionAt?: unknown;
  fleeAt?: unknown;
  stopWhenOutOfSupplies?: unknown;
  spellPriority?: unknown;
  disabledSpells?: unknown;
  lootMinValue?: unknown;
  healthPotionId?: unknown;
  manaPotionId?: unknown;
  healSpellId?: unknown;
  healSpellAt?: unknown;
  magicShield?: unknown;
  magicShieldAt?: unknown;
  autoAttack?: unknown;
  taunt?: unknown;
  lootToWarehouse?: unknown;
  haste?: unknown;
  food?: unknown;
  runeId?: unknown;
  soulRuneId?: unknown;
  supportRuneId?: unknown;
  virtueHarmony?: unknown;
  focusHarmony?: unknown;
  familiar?: unknown;
  cure?: unknown;
  helperMode?: unknown;
  source?: unknown;
  node?: unknown;
  code?: unknown;
  pack?: unknown;
  packs?: unknown;
  cores?: unknown;
  coins?: unknown;
  index?: unknown;
  useCore?: unknown;
  reduceTierLoss?: unknown;
  donorSlot?: unknown;
  receiveSlot?: unknown;
  helperCopyFrom?: unknown;
  helperReset?: unknown;
  bloodRage?: unknown;
  protector?: unknown;
  sharpshooter?: unknown;
  spiritPotionId?: unknown;
};

export function act(
  db: Database,
  accountId: number,
  characterId: number,
  body: ActBody,
  now = Date.now(),
): { loaded: LoadedCharacter; targetLoaded?: LoadedCharacter; extra?: Record<string, unknown> } {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const type = String(body.type ?? '');
  let targetLoaded = loaded;
  if ((type === 'equip' || type === 'unequip') && body.targetCharacterId !== undefined) {
    const targetId = Number(body.targetCharacterId);
    if (!Number.isInteger(targetId) || !canManageActivePartyMember(db, accountId, characterId, targetId)) {
      throw new GameError('O personagem não está ativo na sua party.', 403);
    }
    targetLoaded = targetId === characterId ? loaded : loadCharacter(db, accountId, targetId, now).loaded;
  }
  const character = targetLoaded.character;

  switch (type) {
    case 'daily': {
      const day = new Date(now).toISOString().slice(0, 10);
      if (character.dailyClaim === day) throw new GameError('Daily already claimed today.', 409);
      const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
      character.dailyStreak = character.dailyClaim === yesterday ? Math.min(7, character.dailyStreak + 1) : 1;
      character.dailyClaim = day;
      const gold = 400 * character.dailyStreak;
      const coins = character.dailyStreak >= 3 ? 3 : 1;
      character.gold += gold;
      character.coins += coins;
      character.preyRerolls += 1;
      character.preyWildcards = preyWildcards(character) + 1;
      character.xpBoostUntil = now + DAILY_XP_BOOST_MS;
      persist(db, loaded, now);
      db.insertChat('comunicados', 'Sistema', `${character.name} coletou o daily (dia ${character.dailyStreak}).`);
      return { loaded, extra: { gold, coins, streak: character.dailyStreak } };
    }

    case 'prey-reroll':
    case 'prey-list-reroll': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      spendPreyListReroll(character, slot, now);
      character.prey[slot] = rerollPreyList(character.prey[slot]!, character, preyExcludeMonsters(character, slot), now);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'prey-select': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      const monsterId = String(body.monsterId ?? '');
      const current = character.prey[slot]!;
      if (isPreyActive(current, now)) throw new GameError('That prey slot is already active.', 409);
      if (!current.candidates?.includes(monsterId)) throw new GameError('That creature is not on your prey list.', 400);
      if (preyExcludeMonsters(character, slot).includes(monsterId)) {
        throw new GameError('That creature is already selected in another prey slot.', 409);
      }
      character.prey[slot] = activatePreyMonster(current, monsterId, now);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'prey-bonus-reroll': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      const current = character.prey[slot]!;
      if (!isPreyActive(current, now)) throw new GameError('Activate a prey first.', 409);
      if (preyWildcards(character) < PREY_WILDCARD_AUTO_BONUS) {
        throw new GameError(`Need ${PREY_WILDCARD_AUTO_BONUS} Prey Wildcard.`, 402);
      }
      character.preyWildcards = preyWildcards(character) - PREY_WILDCARD_AUTO_BONUS;
      syncPreyWildcards(character);
      const rolled = rollPreyBonusReroll(current);
      current.bonus = rolled.bonus;
      current.star = rolled.star;
      current.expiresAt = now + PREY_DURATION_MS;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'prey-wildcard-pick': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      const monsterId = String(body.monsterId ?? '');
      const current = character.prey[slot]!;
      if (isPreyActive(current, now)) throw new GameError('Finish the active prey first.', 409);
      if (!monstersById.has(monsterId)) throw new GameError('Unknown creature.');
      if (!preyPool(character).includes(monsterId)) throw new GameError('That creature is not available as prey.', 400);
      if (preyExcludeMonsters(character, slot).includes(monsterId)) {
        throw new GameError('That creature is already selected in another prey slot.', 409);
      }
      if (preyWildcards(character) < PREY_WILDCARD_PICK) {
        throw new GameError(`Need ${PREY_WILDCARD_PICK} Prey Wildcards.`, 402);
      }
      character.preyWildcards = preyWildcards(character) - PREY_WILDCARD_PICK;
      syncPreyWildcards(character);
      character.prey[slot] = activatePreyMonster(current, monsterId, now);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'prey-lock':
    case 'prey-toggle-lock': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      const current = character.prey[slot]!;
      if (!isPreyActive(current, now)) throw new GameError('Activate a prey first.', 409);
      current.locked = !current.locked;
      if (current.locked) current.autoBonusReroll = false;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'prey-toggle-auto-bonus': {
      const slot = preySlotIndex(character, Number(body.slot), now);
      const current = character.prey[slot]!;
      if (!isPreyActive(current, now)) throw new GameError('Activate a prey first.', 409);
      current.autoBonusReroll = !current.autoBonusReroll;
      if (current.autoBonusReroll) current.locked = false;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'charm-unlock': {
      const charmId = Number(body.charmId);
      const charm = charms.find((entry) => entry.id === charmId);
      if (!charm) throw new GameError('Unknown charm.');
      if (character.charmsUnlocked.includes(charmId)) throw new GameError('Already unlocked.', 409);
      if (charmPointsLeft(character) < charm.points[0]) throw new GameError('Not enough charm points.', 402);
      character.charmsUnlocked.push(charmId);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'charm-bind': {
      const charmId = Number(body.charmId);
      const monsterId = String(body.monsterId ?? '');
      if (!character.charmsUnlocked.includes(charmId)) throw new GameError('Unlock that charm first.');
      if (!monstersById.has(monsterId)) throw new GameError('Unknown creature.');
      const kills = character.bestiary[monsterId] ?? 0;
      const goal = monstersById.get(monsterId)?.bestiary?.toKill ?? 1;
      if (kills < goal) throw new GameError('Finish that bestiary entry first.');
      character.charmBinds = character.charmBinds.filter((bind) => bind.charmId !== charmId);
      character.charmBinds.push({ charmId, monsterId });
      persist(db, loaded, now);
      return { loaded };
    }

    case 'imbue': {
      requireIdle(loaded);
      const slot = String(body.slot) as EquipSlot;
      const imbue = String(body.imbue ?? '');
      const tier = Number(body.tier);
      const spec = IMBUEMENTS.find((entry) => entry.id === imbue);
      if (!spec || !spec.slots.includes(slot)) throw new GameError('That imbuement does not fit.');
      if (![1, 2, 3].includes(tier)) throw new GameError('Tier is 1, 2 or 3.');
      const itemId = character.equipment[slot];
      if (!itemId) throw new GameError('Nothing equipped in that slot.');
      const maxSlots = itemImbuementSlots(itemId);
      if (maxSlots <= 0) throw new GameError('That item has no imbuement slots.');
      const cost = spec.cost[tier - 1] ?? 0;
      if (character.gold < cost) throw new GameError('Not enough gold.', 402);
      const reagents = imbueReagentsFor(spec, tier);
      for (const reagent of reagents) {
        const item = itemsByName.get(reagent.name);
        if (!item) throw new GameError(`Unknown shrine item: ${reagent.name}.`);
        const stack = character.warehouse.find((entry) => entry.itemId === item.id);
        if (!stack || stack.count < reagent.count) {
          throw new GameError(`Need ${reagent.count}× ${reagent.name} in the warehouse.`, 402);
        }
      }
      for (const reagent of reagents) {
        const item = itemsByName.get(reagent.name)!;
        takeStack(character.warehouse, item.id, reagent.count);
      }
      character.gold -= cost;
      // Same Crystal category cannot stack on one piece — replace it.
      character.imbuements = (character.imbuements ?? []).filter((entry) => {
        if (entry.slot !== slot) return true;
        const other = IMBUEMENTS.find((item) => item.id === entry.type);
        return other?.category !== spec.category;
      });
      let index = Number(body.index);
      if (!Number.isInteger(index) || index < 0) {
        index = nextImbueIndex(character, slot, now);
      }
      if (index < 0 || index >= maxSlots) {
        // Piece is full — overwrite index 0 of remaining.
        index = 0;
        character.imbuements = character.imbuements.filter(
          (entry) => !(entry.slot === slot && (entry.index ?? 0) === 0),
        );
      }
      character.imbuements.push({
        slot, index, type: imbue, tier, expiresAt: now + IMBUEMENT_DURATION_MS,
      });
      persist(db, loaded, now);
      return { loaded };
    }

    case 'imbue-clear': {
      requireIdle(loaded);
      const slot = String(body.slot) as EquipSlot;
      const index = Number(body.index);
      if (!character.equipment[slot]) throw new GameError('Nothing equipped in that slot.');
      const active = (character.imbuements ?? []).filter((entry) => entry.slot === slot && entry.expiresAt > now);
      if (!active.length) throw new GameError('No active imbuement on that piece.');
      let targetIndex = Number.isInteger(index) ? index : active[0]!.index ?? 0;
      const target = active.find((entry) => (entry.index ?? 0) === targetIndex);
      if (!target) throw new GameError('That imbuement slot is empty.');
      if (character.gold < IMBUEMENT_CLEAR_COST) throw new GameError(`Need ${IMBUEMENT_CLEAR_COST} gold.`, 402);
      character.gold -= IMBUEMENT_CLEAR_COST;
      character.imbuements = character.imbuements.filter(
        (entry) => !(entry.slot === slot && (entry.index ?? 0) === targetIndex && entry.type === target.type),
      );
      persist(db, loaded, now);
      return { loaded };
    }

    case 'forge': {
      requireIdle(loaded);
      const monsterId = String(body.monsterId ?? '');
      if (!monstersById.has(monsterId)) throw new GameError('Unknown creature.');
      const current = character.forge[monsterId] ?? 0;
      if (current >= 100) throw new GameError('That creature is already fully influenced.', 409);
      const cost = 2_000 * (current + 1);
      if (character.gold < cost) throw new GameError(`Need ${cost} gold.`, 402);
      character.gold -= cost;
      character.forge[monsterId] = current + 5;
      persist(db, loaded, now);
      return { loaded, extra: { influence: character.forge[monsterId], cost } };
    }

    case 'exalt': {
      requireIdle(loaded);
      const slot = String(body.slot ?? '') as EquipSlot;
      const useCore = Boolean(body.useCore);
      const reduceTierLoss = Boolean(body.reduceTierLoss);
      const rng = new Rng(
        BigInt(Date.now())
          ^ (BigInt(loaded.row.id & 0xffffffff) << 21n)
          ^ BigInt(((character.forgeDust ?? 0) + 1) * 0x85eb),
      );
      const result = exaltSlot(character, slot, { useCore, reduceTierLoss }, rng);
      if (!result.ok) throw new GameError(result.reason, result.reason.startsWith('Need') ? 402 : 400);
      persist(db, loaded, now);
      return {
        loaded,
        extra: {
          success: result.success,
          tier: result.tier,
          previousTier: result.previousTier,
          cost: result.cost,
          dustCost: result.dustCost,
          coresSpent: result.coresSpent,
          tierLost: result.tierLost,
          successChance: result.successChance,
          slot,
          forgeDust: character.forgeDust,
          forgeCores: character.forgeCores,
        },
      };
    }

    case 'forge-convergence-fusion': {
      requireIdle(loaded);
      const slot = String(body.slot ?? '') as EquipSlot;
      const result = convergenceFuseSlot(character, slot);
      if (!result.ok) throw new GameError(result.reason, result.reason.startsWith('Need') ? 402 : 400);
      persist(db, loaded, now);
      return {
        loaded,
        extra: {
          success: true,
          tier: result.tier,
          previousTier: result.previousTier,
          cost: result.cost,
          dustCost: result.dustCost,
          slot,
          forgeDust: character.forgeDust,
        },
      };
    }

    case 'forge-transfer': {
      requireIdle(loaded);
      const donorSlot = String(body.donorSlot ?? '') as EquipSlot;
      const receiveSlot = String(body.receiveSlot ?? '') as EquipSlot;
      const convergence = Boolean(body.convergence);
      const result = transferSlotTier(character, donorSlot, receiveSlot, convergence);
      if (!result.ok) throw new GameError(result.reason, result.reason.startsWith('Need') ? 402 : 400);
      persist(db, loaded, now);
      return {
        loaded,
        extra: {
          success: true,
          donorSlot: result.donorSlot,
          receiveSlot: result.receiveSlot,
          donorTier: result.donorTier,
          receiveTier: result.receiveTier,
          cost: result.cost,
          dustCost: result.dustCost,
          coresSpent: result.coresSpent,
          convergence: result.convergence,
          forgeDust: character.forgeDust,
          forgeCores: character.forgeCores,
        },
      };
    }

    case 'forge-dust-cap': {
      requireIdle(loaded);
      const result = raiseForgeDustCap(character);
      if (!result.ok) throw new GameError(result.reason, result.reason.startsWith('Need') ? 402 : 400);
      persist(db, loaded, now);
      return { loaded, extra: { level: result.level, cost: result.cost } };
    }

    case 'forge-dust-slivers': {
      requireIdle(loaded);
      const packs = Math.max(1, Number(body.packs) || 1);
      const result = convertDustToSlivers(character, packs);
      if (!result.ok) throw new GameError(result.reason, 402);
      persist(db, loaded, now);
      return { loaded, extra: result };
    }

    case 'forge-slivers-core': {
      requireIdle(loaded);
      const cores = Math.max(1, Number(body.cores) || 1);
      const result = convertSliversToCore(character, cores);
      if (!result.ok) throw new GameError(result.reason, 402);
      persist(db, loaded, now);
      return { loaded, extra: result };
    }

    case 'equip': {
      const itemId = Number(body.itemId);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');
      const source = String(body.source ?? 'warehouse');
      if (source === 'pouch') {
        if (!loaded.session) throw new GameError('You are not hunting.', 409);
        const count = loaded.session.totals.lootByItem[itemId] ?? 0;
        if (count < 1) throw new GameError('That item is not in the pouch.', 400);
        loaded.session.totals.lootByItem[itemId] = count - 1;
        if (loaded.session.totals.lootByItem[itemId]! <= 0) delete loaded.session.totals.lootByItem[itemId];
      } else if (source === 'supply') {
        takeStack(character.supplies, itemId, 1);
      } else if (source === 'backpack') {
        takeStack(character.backpackContents ?? [], itemId, 1);
      } else {
        takeStack(character.warehouse, itemId, 1);
      }
      const worn = wearItem(character, itemId);
      if (!worn.ok) {
        if (source === 'pouch' && loaded.session) {
          loaded.session.totals.lootByItem[itemId] = (loaded.session.totals.lootByItem[itemId] ?? 0) + 1;
        } else if (source === 'supply') {
          addStack(character.supplies, itemId, 1);
        } else if (source === 'backpack') {
          addStack(character.backpackContents ?? [], itemId, 1);
        } else {
          addStack(character.warehouse, itemId, 1);
        }
        throw new GameError(worn.reason, 400);
      }
      persist(db, targetLoaded, now);
      return { loaded, targetLoaded: targetLoaded === loaded ? undefined : targetLoaded, extra: { slot: worn.slot } };
    }

    case 'unequip': {
      const slot = String(body.slot ?? '') as EquipSlot;
      const removed = removeWorn(character, slot);
      if (!removed.ok) throw new GameError(removed.reason, 400);
      persist(db, targetLoaded, now);
      return { loaded, targetLoaded: targetLoaded === loaded ? undefined : targetLoaded, extra: { itemId: removed.itemId } };
    }

    case 'destroy-item': {
      const itemId = Number(body.itemId);
      const source = String(body.source ?? '');
      const count = Math.max(1, Number(body.count) || 1);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');
      if (source === 'pouch') {
        if (!loaded.session) throw new GameError('You are not hunting.', 409);
        const have = loaded.session.totals.lootByItem[itemId] ?? 0;
        if (have < count) throw new GameError('That item is not in the pouch.', 400);
        const left = have - count;
        if (left <= 0) delete loaded.session.totals.lootByItem[itemId];
        else loaded.session.totals.lootByItem[itemId] = left;
      } else if (source === 'supply') {
        takeStack(character.supplies, itemId, count);
      } else if (source === 'backpack') {
        takeStack(character.backpackContents ?? [], itemId, count);
      } else if (source === 'warehouse') {
        takeStack(character.warehouse, itemId, count);
      } else if (source === 'worn') {
        const slot = String(body.slot ?? '') as EquipSlot;
        if (character.equipment[slot] !== itemId) throw new GameError('That slot does not hold the item.', 400);
        delete character.equipment[slot];
        if (character.equipmentTiers) delete character.equipmentTiers[slot];
      } else {
        throw new GameError('Unknown item source.');
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'sell-item': {
      const itemId = Number(body.itemId);
      const source = String(body.source ?? '');
      const count = Math.max(1, Number(body.count) || 1);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');
      const unit = itemsById.get(itemId)?.sellPrice ?? 0;
      if (unit <= 0) throw new GameError('Nobody buys that item.', 400);
      if (source === 'pouch') {
        if (!loaded.session) throw new GameError('You are not hunting.', 409);
        const have = loaded.session.totals.lootByItem[itemId] ?? 0;
        if (have < count) throw new GameError('That item is not in the pouch.', 400);
        const left = have - count;
        if (left <= 0) delete loaded.session.totals.lootByItem[itemId];
        else loaded.session.totals.lootByItem[itemId] = left;
        loaded.session.character.gold += unit * count;
        character.gold = loaded.session.character.gold;
      } else if (source === 'supply') {
        takeStack(character.supplies, itemId, count);
        character.gold += unit * count;
      } else if (source === 'backpack') {
        takeStack(character.backpackContents ?? [], itemId, count);
        character.gold += unit * count;
      } else if (source === 'warehouse') {
        takeStack(character.warehouse, itemId, count);
        character.gold += unit * count;
      } else {
        throw new GameError('Unknown item source.');
      }
      persist(db, loaded, now);
      return { loaded, extra: { gold: unit * count } };
    }

    case 'move-item': {
      const itemId = Number(body.itemId);
      const source = String(body.source ?? '');
      const count = Math.max(1, Number(body.count) || 1);
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');
      character.backpackContents ??= [];
      if (source === 'pouch') {
        if (!loaded.session) throw new GameError('You are not hunting.', 409);
        const have = loaded.session.totals.lootByItem[itemId] ?? 0;
        if (have < count) throw new GameError('That item is not in the pouch.', 400);
        const left = have - count;
        if (left <= 0) delete loaded.session.totals.lootByItem[itemId];
        else loaded.session.totals.lootByItem[itemId] = left;
      } else if (source === 'supply') {
        takeStack(character.supplies, itemId, count);
      } else {
        throw new GameError('Unknown item source.');
      }
      const moved = moveStackToBackpack(character, itemId, count);
      if (!moved.ok) {
        if (source === 'pouch' && loaded.session) {
          loaded.session.totals.lootByItem[itemId] = (loaded.session.totals.lootByItem[itemId] ?? 0) + count;
        } else if (source === 'supply') {
          addStack(character.supplies, itemId, count);
        }
        throw new GameError(moved.reason, 400);
      }
      if (loaded.session) {
        loaded.session.character.backpackContents = character.backpackContents;
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'backpack-withdraw': {
      const itemId = Number(body.itemId);
      const count = Math.max(1, Number(body.count) || 1);
      const target = String(body.target ?? 'supply');
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');
      character.backpackContents ??= [];
      takeStack(character.backpackContents, itemId, count);
      if (target === 'warehouse') {
        character.warehouse ??= [];
        if (!warehouseHasRoom(character.warehouse, itemId)) {
          addStack(character.backpackContents, itemId, count);
          throw new GameError('Depot cheio (200 slots).', 400);
        }
        addStack(character.warehouse, itemId, count);
      } else {
        const moved = moveStackToSupply(character, itemId, count);
        if (!moved.ok) {
          addStack(character.backpackContents, itemId, count);
          throw new GameError(moved.reason, 400);
        }
      }
      if (loaded.session) {
        loaded.session.character.backpackContents = character.backpackContents;
        loaded.session.character.warehouse = character.warehouse;
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'use-item': {
      const itemId = Number(body.itemId);
      const sourceRaw = String(body.source ?? 'supply');
      if (!Number.isInteger(itemId) || itemId <= 0) throw new GameError('Unknown item.');

      if (sourceRaw === 'pouch') {
        if (!loaded.session) throw new GameError('You are not hunting.', 409);
        const have = loaded.session.totals.lootByItem[itemId] ?? 0;
        if (have < 1) throw new GameError('That item is not in the pouch.', 400);
        loaded.session.totals.lootByItem[itemId] = have - 1;
        if (loaded.session.totals.lootByItem[itemId]! <= 0) delete loaded.session.totals.lootByItem[itemId];
        addStack(character.supplies, itemId, 1);
        const result = useConsumableItem(character, itemId, 'supply');
        if (!result.ok) {
          takeStack(character.supplies, itemId, 1);
          loaded.session.totals.lootByItem[itemId] = (loaded.session.totals.lootByItem[itemId] ?? 0) + 1;
          throw new GameError(result.reason, 400);
        }
        loaded.session.character.health = character.health;
        loaded.session.character.mana = character.mana;
        loaded.session.character.supplies = character.supplies;
        loaded.session.totals.potionsUsed += 1;
        loaded.session.totals.supplyValue += supplyUnitCost(itemId);
        loaded.session.totals.suppliesByItem[itemId] = (loaded.session.totals.suppliesByItem[itemId] ?? 0) + 1;
        loaded.session.healCooldownTicks = HEAL_EXHAUST_TICKS;
        persist(db, loaded, now);
        return { loaded, extra: result };
      }

      if (sourceRaw === 'backpack') {
        character.backpackContents ??= [];
        takeStack(character.backpackContents, itemId, 1);
        addStack(character.supplies, itemId, 1);
        const result = useConsumableItem(character, itemId, 'supply');
        if (!result.ok) {
          takeStack(character.supplies, itemId, 1);
          addStack(character.backpackContents, itemId, 1);
          throw new GameError(result.reason, 400);
        }
        if (loaded.session) {
          loaded.session.character.health = character.health;
          loaded.session.character.mana = character.mana;
          loaded.session.character.supplies = character.supplies;
          loaded.session.character.backpackContents = character.backpackContents;
          loaded.session.totals.potionsUsed += 1;
          loaded.session.totals.supplyValue += supplyUnitCost(itemId);
          loaded.session.totals.suppliesByItem[itemId] = (loaded.session.totals.suppliesByItem[itemId] ?? 0) + 1;
          loaded.session.healCooldownTicks = HEAL_EXHAUST_TICKS;
        }
        persist(db, loaded, now);
        return { loaded, extra: result };
      }

      const source = sourceRaw === 'warehouse' ? 'warehouse' : 'supply';
      const result = useConsumableItem(character, itemId, source);
      if (!result.ok) throw new GameError(result.reason, 400);
      if (loaded.session) {
        loaded.session.character.health = character.health;
        loaded.session.character.mana = character.mana;
        loaded.session.character.supplies = character.supplies;
        loaded.session.totals.potionsUsed += 1;
        loaded.session.totals.supplyValue += supplyUnitCost(itemId);
        loaded.session.totals.suppliesByItem[itemId] = (loaded.session.totals.suppliesByItem[itemId] ?? 0) + 1;
        loaded.session.healCooldownTicks = HEAL_EXHAUST_TICKS;
      }
      persist(db, loaded, now);
      return { loaded, extra: result };
    }

    case 'shop': {
      const sku = String(body.sku ?? '');
      const offer = SHOP.find((entry) => entry.id === sku);
      if (!offer) throw new GameError('Unknown shop item.');
      if (offer.kind === 'slot' && characterSlotCap(db, accountId) >= MAX_CHARACTER_SLOTS) {
        throw new GameError('Character slots are already maxed.', 409);
      }
      if (offer.kind === 'outfit' && ownsShopOutfitOffer(character, offer)) {
        throw new GameError('You already own this outfit.', 409);
      }
      if (offer.kind === 'mount' && offer.mount && ownsShopMount(character, offer.mount)) {
        throw new GameError('You already own this mount.', 409);
      }
      if (character.coins < offer.coins) throw new GameError('Not enough coins.', 402);
      if (offer.kind === 'rename') {
        const name = String(body.name ?? '').trim();
        if (!/^[a-zA-Z][a-zA-Z ']{2,19}$/.test(name)) throw new GameError('Invalid nickname.');
        if (db.findCharacterByName(name)) throw new GameError('That name is taken.', 409);
      }
      if (offer.kind === 'exercise' && offer.itemId && offer.itemCount) {
        const result = moveStackToSupply(character, offer.itemId, offer.itemCount);
        if (!result.ok) throw new GameError(result.reason, 400);
      }
      character.coins -= offer.coins;
      if (offer.kind === 'vip') {
        const days = offer.vipDays ?? 7;
        character.premium = true;
        character.vipUntil = Math.max(character.vipUntil, now) + days * 24 * 60 * 60 * 1000;
        while (character.prey.length < 4) character.prey.push(emptyPreySlot());
      } else if (offer.kind === 'reroll') {
        character.preyRerolls += 5;
        character.preyWildcards = preyWildcards(character) + 5;
        syncPreyWildcards(character);
      } else if (offer.kind === 'rename') {
        character.name = String(body.name ?? '').trim();
      } else if (offer.kind === 'colors') {
        character.appearance.head = Math.floor(Math.random() * 132);
        character.appearance.body = Math.floor(Math.random() * 132);
        character.appearance.legs = Math.floor(Math.random() * 132);
        character.appearance.feet = Math.floor(Math.random() * 132);
      } else if (offer.kind === 'outfit') {
        unlockOutfitOffer(character, offer);
      } else if (offer.kind === 'mount' && offer.mount) {
        character.unlockedMounts ??= [];
        if (!character.unlockedMounts.includes(offer.mount)) character.unlockedMounts.push(offer.mount);
        character.appearance.mount = offer.mount;
      } else if (offer.kind === 'aura' && offer.aura) {
        character.appearance.aura = offer.aura;
      } else if (offer.kind === 'slot') {
        buyCharacterSlot(db, accountId);
      } else if (
        (offer.kind === 'xp_boost' || offer.kind === 'loot_boost' || offer.kind === 'gold_boost')
        && offer.boostPercent
        && offer.boostDurationMs
      ) {
        applyStoreBoost(character, offer.kind, offer.boostPercent, offer.boostDurationMs, now);
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'appearance': {
      const outfit = Math.floor(Number(body.outfit ?? character.appearance.outfit));
      const head = Math.floor(Number(body.head ?? character.appearance.head));
      const bodyColor = Math.floor(Number(body.body ?? character.appearance.body));
      const legs = Math.floor(Number(body.legs ?? character.appearance.legs));
      const feet = Math.floor(Number(body.feet ?? character.appearance.feet));
      const addons = Math.floor(Number(body.addons ?? character.appearance.addons ?? 0));
      const mount = Math.floor(Number(body.mount ?? character.appearance.mount ?? 0));
      const aura = Math.floor(Number(body.aura ?? character.appearance.aura ?? 0));
      const clampColor = (value: number) => Math.max(0, Math.min(132, value));
      if (!Number.isInteger(outfit) || outfit < 1) throw new GameError('Invalid outfit.');
      character.unlockedOutfits ??= [character.appearance.outfit];
      for (const entry of outfitsCatalog) {
        if (entry.unlocked !== true && entry.from !== 'default') continue;
        for (const look of [entry.male, entry.female, entry.outfit]) {
          if (look != null && !character.unlockedOutfits.includes(look)) {
            character.unlockedOutfits.push(look);
          }
        }
      }
      if (!character.unlockedOutfits.includes(outfit)) throw new GameError('Outfit not unlocked.', 409);
      if (!outfitMatchesGender(outfit, character.gender ?? 'm')) {
        throw new GameError('Outfit does not match character gender.', 400);
      }
      if (addons < 0 || addons > 3) throw new GameError('Invalid addons.');
      if (mount !== 0 && !ownsShopMount(character, mount)) throw new GameError('Mount not unlocked.', 409);
      if (aura !== 0 && aura !== 1 && aura !== 2) throw new GameError('Invalid aura.');
      character.appearance = {
        outfit,
        head: clampColor(head),
        body: clampColor(bodyColor),
        legs: clampColor(legs),
        feet: clampColor(feet),
        addons,
        mount,
        aura,
      };
      // Keep hunt session appearance in sync if it was a separate snapshot.
      if (loaded.session && loaded.session.character !== character) {
        loaded.session.character.appearance = { ...character.appearance };
        loaded.session.character.unlockedMounts = [...(character.unlockedMounts ?? [])];
        loaded.session.character.unlockedOutfits = [...(character.unlockedOutfits ?? [])];
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'shop-equip': {
      const kind = String(body.kind ?? '');
      const id = Number(body.id);
      if (kind === 'mount-clear') {
        character.appearance.mount = 0;
      } else if (kind === 'addons') {
        if (!Number.isInteger(id) || id < 0 || id > 3) throw new GameError('Invalid addon.', 400);
        character.appearance.addons = id;
      } else if (!Number.isInteger(id) || id < 1) {
        throw new GameError('Invalid cosmetic id.');
      } else if (kind === 'outfit') {
        if (!ownsShopOutfit(character, id)) throw new GameError('Outfit not unlocked.', 409);
        if (!outfitMatchesGender(id, character.gender ?? 'm')) {
          throw new GameError('Outfit does not match character gender.', 400);
        }
        character.appearance.outfit = id;
      } else if (kind === 'mount') {
        if (!ownsShopMount(character, id)) throw new GameError('Mount not unlocked.', 409);
        character.appearance.mount = id;
      } else if (kind === 'aura') {
        if (id !== 1 && id !== 2) throw new GameError('Invalid aura.', 400);
        character.appearance.aura = id;
      } else {
        throw new GameError('Unknown equip kind.');
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'transfer': {
      const name = String(body.name ?? '').trim();
      const coins = Number(body.coins);
      if (!Number.isInteger(coins) || coins < 1) throw new GameError('Send at least 1 coin.');
      if (character.coins < coins) throw new GameError('Not enough coins.', 402);
      const target = db.findCharacterByName(name);
      if (!target) throw new GameError('No character with that name.', 404);
      if (target.id === loaded.row.id) throw new GameError('Cannot transfer to yourself.');
      character.coins -= coins;
      persist(db, loaded, now);
      creditSeller(db, target.id, 0, coins, now);
      return { loaded, extra: { coins, to: name } };
    }

    case 'convert': {
      const gold = Number(body.gold);
      if (!Number.isInteger(gold) || gold < GOLD_PER_COIN) throw new GameError(`Minimum ${GOLD_PER_COIN} gold.`);
      const coins = Math.floor(gold / GOLD_PER_COIN);
      const spent = coins * GOLD_PER_COIN;
      if (character.gold < spent) throw new GameError('Not enough gold.', 402);
      character.gold -= spent;
      character.coins += coins;
      persist(db, loaded, now);
      return { loaded, extra: { coins } };
    }

    case 'warehouse-deposit': {
      const itemId = Number(body.itemId);
      const count = Number(body.count ?? 1);
      character.warehouse ??= [];
      if (!warehouseHasRoom(character.warehouse, itemId)) {
        throw new GameError('Depot cheio (200 slots).', 400);
      }
      takeStack(character.supplies, itemId, count);
      addStack(character.warehouse, itemId, count);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'warehouse-withdraw': {
      const itemId = Number(body.itemId);
      const count = Number(body.count ?? 1);
      const item = itemsById.get(itemId);
      if (item && slotFor(item) && !isConsumableItem(item)) {
        throw new GameError('Equipe esse item pelo armazém ou clique direito no supply pouch.', 400);
      }
      takeStack(character.warehouse, itemId, count);
      const moved = moveStackToSupply(character, itemId, count);
      if (!moved.ok) {
        addStack(character.warehouse, itemId, count);
        throw new GameError(moved.reason, 400);
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'warehouse-sell': {
      let gold = 0;
      for (const stack of character.warehouse) {
        gold += (itemsById.get(stack.itemId)?.sellPrice ?? 0) * stack.count;
      }
      character.gold += gold;
      character.warehouse = [];
      persist(db, loaded, now);
      return { loaded, extra: { gold } };
    }

    case 'blessing': {
      const mask = normalizeBlessingMask(character.blessings ?? 0);
      const buyAll = body.buyAll === true;
      const blessIndex = body.blessIndex !== undefined ? Number(body.blessIndex) : -1;
      const unit = blessingCost(character.level);

      if (buyAll) {
        const missing = missingBlessingIndices(mask);
        if (missing.length === 0) throw new GameError('You already carry every blessing.', 409);
        const cost = buyAllBlessingsCost(character.level, mask);
        if (character.gold < cost) throw new GameError(`Need ${cost.toLocaleString()} gold.`, 402);
        character.gold -= cost;
        character.blessings = BLESSING_BITS.reduce((next, bit) => next | bit, 0);
        character.blessingsVersion = 1;
        persist(db, loaded, now);
        return { loaded, extra: { gold: cost, blessings: character.blessings } };
      }

      if (blessIndex >= 0 && blessIndex < BLESSING_CAP) {
        if (hasBlessing(mask, blessIndex)) throw new GameError('You already have that blessing.', 409);
        if (character.gold < unit) throw new GameError(`Need ${unit.toLocaleString()} gold.`, 402);
        character.gold -= unit;
        character.blessings = mask | BLESSING_BITS[blessIndex]!;
        character.blessingsVersion = 1;
        persist(db, loaded, now);
        return { loaded, extra: { gold: unit, blessings: character.blessings } };
      }

      const missing = missingBlessingIndices(mask);
      if (missing.length === 0) throw new GameError('You already carry every blessing.', 409);
      if (character.gold < unit) throw new GameError(`Need ${unit.toLocaleString()} gold.`, 402);
      character.gold -= unit;
      character.blessings = mask | BLESSING_BITS[missing[0]!]!;
      character.blessingsVersion = 1;
      persist(db, loaded, now);
      return { loaded, extra: { gold: unit, blessings: character.blessings } };
    }

    case 'promotion': {
      requireIdle(loaded);
      const result = promoteCharacter(character);
      if (!result.ok) {
        throw new GameError(result.reason, result.reason.startsWith('Need') ? 402 : 409);
      }
      db.updateVocationId(loaded.row.id, character.vocationId);
      loaded.row.vocationId = character.vocationId;
      persist(db, loaded, now);
      return { loaded, extra: { vocationId: character.vocationId } };
    }

    case 'task-roll': {
      const huntId = typeof body.huntId === 'string' && body.huntId
        ? body.huntId
        : (loaded.session?.huntId ?? character.lastHuntId ?? TUTORIAL_HUNT_ID);
      if (character.task && !character.task.claimed) {
        if (character.gold < TASK_SKIP_GOLD) throw new GameError(`Need ${TASK_SKIP_GOLD} gold to skip.`, 402);
        character.gold -= TASK_SKIP_GOLD;
      }
      character.task = makeHuntTask(character, huntId);
      character.lastHuntId = huntId;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'npc-buy': {
      const itemId = Number(body.itemId);
      const count = Math.max(1, Number(body.count ?? 1));
      const item = itemsById.get(itemId);
      const unit = item ? marketBuyPrice(item) : null;
      if (!item || unit === null || !isMarketItem(item.name)) throw new GameError('The merchant does not sell that.');
      const cost = unit * count;
      if (character.gold < cost) throw new GameError('Not enough gold.', 402);
      character.gold -= cost;
      const received = acquireItemStacks(character, itemId, count);
      if (!received.ok) {
        character.gold += cost;
        throw new GameError(received.reason, 400);
      }
      if (loaded.session) {
        loaded.session.character.supplies = character.supplies;
        loaded.session.character.backpackContents = character.backpackContents;
        loaded.session.character.equipment = character.equipment;
        loaded.session.character.warehouse = character.warehouse;
        loaded.session.character.gold = character.gold;
      }
      db.insertChat('market', character.name, `Comprou ${item.name} x${count}.`);
      persist(db, loaded, now);
      return { loaded, extra: received };
    }

    case 'npc-sell': {
      const itemId = Number(body.itemId);
      const count = Math.max(1, Number(body.count ?? 1));
      const item = itemsById.get(itemId);
      takeStack(character.warehouse, itemId, count);
      const gold = (item?.sellPrice ?? 0) * count;
      character.gold += gold;
      persist(db, loaded, now);
      return { loaded, extra: { gold } };
    }

    case 'party-unlock': {
      if (character.partySlots >= 3) throw new GameError('Party is full.', 409);
      if (character.partySlots === 1) {
        if (character.gold < PARTY_SLOT_GOLD) throw new GameError(`Need ${PARTY_SLOT_GOLD} gold.`, 402);
        character.gold -= PARTY_SLOT_GOLD;
        character.partySlots = 2;
      } else {
        if (character.coins < PARTY_SLOT_COINS) throw new GameError(`Need ${PARTY_SLOT_COINS} coins.`, 402);
        character.coins -= PARTY_SLOT_COINS;
        character.partySlots = 3;
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'loot-slot': {
      const slots = character.lootSlots ?? LOOT_SLOT_DEFAULT;
      if (slots >= LOOT_SLOT_CAP) throw new GameError('Loot pouch is already maxed.', 409);
      const currency = body.currency === 'coins' ? 'coins' : 'gold';
      const cost = currency === 'coins' ? lootSlotCoinCost(slots) : lootSlotUpgradeCost(slots);
      if (currency === 'coins') {
        if (character.coins < cost) throw new GameError(`Need ${cost} Tibia Coins.`, 402);
        character.coins -= cost;
      } else {
        if (character.gold < cost) throw new GameError(`Need ${cost} gold.`, 402);
        character.gold -= cost;
      }
      character.lootSlots = Math.min(LOOT_SLOT_CAP, slots + LOOT_SLOT_STEP);
      persist(db, loaded, now);
      return { loaded, extra: { cost, currency } };
    }

    case 'supply-slot': {
      const slots = character.supplySlots ?? 20;
      if (slots >= SUPPLY_SLOT_CAP) throw new GameError('Supply pouch is already maxed.', 409);
      const currency = body.currency === 'coins' ? 'coins' : 'gold';
      const cost = currency === 'coins' ? supplySlotCoinCost(slots) : supplySlotUpgradeCost(slots);
      if (currency === 'coins') {
        if (character.coins < cost) throw new GameError(`Need ${cost} Tibia Coins.`, 402);
        character.coins -= cost;
      } else {
        if (character.gold < cost) throw new GameError(`Need ${cost} gold.`, 402);
        character.gold -= cost;
      }
      character.supplySlots = Math.min(SUPPLY_SLOT_CAP, slots + SUPPLY_SLOT_STEP);
      persist(db, loaded, now);
      return { loaded, extra: { cost, currency } };
    }

    case 'preset-save': {
      const slot = Math.floor(Number(body.slot));
      if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_CAP) throw new GameError('Invalid preset slot.');
      const presets = [...(character.appearancePresets ?? [])];
      presets[slot] = { ...character.appearance };
      character.appearancePresets = presets;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'preset-load': {
      const slot = Math.floor(Number(body.slot));
      const preset = character.appearancePresets?.[slot];
      if (!preset) throw new GameError('Empty preset.', 404);
      character.appearance = { ...preset };
      persist(db, loaded, now);
      return { loaded };
    }

    case 'decorate': {
      const id = String(body.decoration ?? '');
      const deco = DECORATIONS.find((entry) => entry.id === id);
      if (!deco) throw new GameError('Unknown decoration.');
      if (character.decorations.includes(id)) throw new GameError('Already unlocked.', 409);
      if (character.gold < deco.cost) throw new GameError('Not enough gold.', 402);
      character.gold -= deco.cost;
      character.decorations.push(id);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'market-list': {
      requireIdle(loaded);
      const itemId = Number(body.itemId);
      const count = Math.max(1, Number(body.count ?? 1));
      const price = Number(body.price);
      const currency = body.currency === 'coins' ? 'coins' : 'gold';
      if (!Number.isInteger(price) || price <= 0) throw new GameError('Invalid price.');
      takeStack(character.warehouse, itemId, count);
      persist(db, loaded, now);
      const listingId = db.insertMarket({
        sellerId: loaded.row.id,
        sellerName: character.name,
        itemId,
        count,
        price,
        currency,
      });
      db.insertChat('market', character.name, `Listou ${itemsById.get(itemId)?.name ?? itemId} x${count}.`);
      return { loaded, extra: { listingId } };
    }

    case 'market-buy': {
      const listingId = Number(body.listingId);
      const listing = db.findMarket(listingId);
      if (!listing) throw new GameError('Listing gone.', 404);
      const sellerId = Number(listing['seller_id']);
      if (sellerId === loaded.row.id) throw new GameError('That is your own listing.');
      const itemId = Number(listing['item_id']);
      const count = Number(listing['count']);
      const item = itemsById.get(itemId);
      const price = Number(listing['price']);
      const currency = String(listing['currency']);
      if (currency === 'coins') {
        if (character.coins < price) throw new GameError('Not enough coins.', 402);
      } else if (character.gold < price) {
        throw new GameError('Not enough gold.', 402);
      }
      const received = acquireItemStacks(character, itemId, count);
      if (!received.ok) throw new GameError(received.reason, 400);
      if (currency === 'coins') {
        character.coins -= price;
        creditSeller(db, sellerId, 0, Math.floor(price * 0.98), now);
      } else {
        character.gold -= price;
        creditSeller(db, sellerId, Math.floor(price * 0.98), 0, now);
      }
      if (loaded.session) {
        loaded.session.character.supplies = character.supplies;
        loaded.session.character.backpackContents = character.backpackContents;
        loaded.session.character.equipment = character.equipment;
        loaded.session.character.warehouse = character.warehouse;
        loaded.session.character.gold = character.gold;
        loaded.session.character.coins = character.coins;
      }
      db.deleteMarket(listingId);
      db.insertChat('market', character.name, `Comprou ${item?.name ?? itemId} x${count} no mercado.`);
      persist(db, loaded, now);
      return { loaded, extra: received };
    }

    case 'guild-create': {
      const name = String(body.name ?? '').trim();
      if (!/^[a-zA-Z][a-zA-Z0-9 ']{2,23}$/.test(name)) throw new GameError('Guild name is 3-24 letters.');
      if (character.guildId) throw new GameError('Leave your guild first.', 409);
      if (character.gold < GUILD_COST) throw new GameError(`Need ${GUILD_COST} gold.`, 402);
      if (db.findGuildByName(name)) throw new GameError('That guild exists.', 409);
      character.gold -= GUILD_COST;
      const guildId = db.insertGuild(name, loaded.row.id, `Bem-vindos à ${name}.`);
      db.addGuildMember(guildId, loaded.row.id, character.name, 'Leader');
      character.guildId = guildId;
      persist(db, loaded, now);
      db.insertChat('comunicados', 'Sistema', `${character.name} fundou a guild ${name}.`);
      return { loaded };
    }

    case 'guild-join': {
      const guildId = Number(body.guildId);
      const guild = db.findGuild(guildId);
      if (!guild) throw new GameError('Guild not found.', 404);
      if (character.guildId) throw new GameError('Already in a guild.', 409);
      db.addGuildMember(guildId, loaded.row.id, character.name, 'Member');
      character.guildId = guildId;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'guild-leave': {
      const guildId = character.guildId;
      if (!guildId) throw new GameError('You are not in a guild.', 409);
      const guild = db.findGuild(guildId);
      if (!guild) {
        character.guildId = null;
        persist(db, loaded, now);
        return { loaded };
      }
      const members = db.guildMembers(guildId);
      const leaderId = Number(guild['leader_id']);
      db.removeGuildMember(guildId, loaded.row.id);
      character.guildId = null;
      if (leaderId === loaded.row.id) {
        const remaining = members.filter((member) => Number(member['character_id']) !== loaded.row.id);
        if (remaining.length === 0) {
          db.deleteGuild(guildId);
        } else {
          const nextId = Number(remaining[0]!['character_id']);
          db.setGuildLeader(guildId, nextId);
          db.setGuildMemberRank(guildId, nextId, 'Leader');
        }
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'guild-kick': {
      const guildId = character.guildId;
      if (!guildId) throw new GameError('You are not in a guild.', 409);
      const guild = db.findGuild(guildId);
      if (!guild) throw new GameError('Guild not found.', 404);
      if (Number(guild['leader_id']) !== loaded.row.id) throw new GameError('Only the leader can kick.', 403);
      const targetId = Number(body.characterId);
      if (!targetId || targetId === loaded.row.id) throw new GameError('Pick a member to kick.');
      const members = db.guildMembers(guildId);
      if (!members.some((member) => Number(member['character_id']) === targetId)) {
        throw new GameError('That hunter is not in your guild.', 404);
      }
      db.removeGuildMember(guildId, targetId);
      patchCharacterGuild(db, targetId, null, now);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'arena': {
      const defenderId = Number(body.defenderId);
      if (defenderId === loaded.row.id) throw new GameError('Pick another fighter.');
      const defenderRow = db.findCharacter(defenderId);
      if (!defenderRow) throw new GameError('Fighter not found.', 404);
      const defender = JSON.parse(defenderRow.state) as CharacterState;
      const savedAtk = character.policy;
      const savedDef = defender.policy;
      character.policy = policyForMode(character, 'pvp');
      defender.policy = policyForMode(defender, 'pvp');
      const atkDps = Math.max(1, estimateDamagePerSecond(character, 3));
      const defDps = Math.max(1, estimateDamagePerSecond(defender, 3));
      character.policy = savedAtk;
      defender.policy = savedDef;
      const atkHp = deriveStats(character).maxHealth;
      const defHp = deriveStats(defender).maxHealth;
      const won = defHp / atkDps <= atkHp / defDps;
      const gold = 200 + Math.max(character.level, defender.level) * 10;
      if (won) {
        character.arenaWins += 1;
        character.gold += gold;
      } else {
        character.arenaLosses += 1;
      }
      persist(db, loaded, now);
      db.insertArena(character.name, defender.name, won ? character.name : defender.name, won ? gold : 0);
      db.insertChat('comunicados', 'Arena', `${won ? character.name : defender.name} venceu ${character.name} vs ${defender.name}.`);
      return { loaded, extra: { won, gold: won ? gold : 0, opponent: defender.name } };
    }

    case 'policy': {
      const mode: HelperMode = body.helperMode === 'boss' || body.helperMode === 'pvp' ? body.helperMode : 'hunt';
      if (mode !== 'hunt') {
        character.helperProfiles ??= {};
        character.helperProfiles[mode] ??= clonePolicy(character.policy);
      }
      const policy = mode === 'hunt' ? character.policy : character.helperProfiles[mode]!;
      const clamp = (value: unknown, min: number, max: number, fallback: number) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
      };
      if (body.healthPotionAt !== undefined) policy.healthPotionAt = clamp(body.healthPotionAt, 0.15, 0.95, policy.healthPotionAt);
      if (body.manaPotionAt !== undefined) policy.manaPotionAt = clamp(body.manaPotionAt, 0.1, 0.95, policy.manaPotionAt);
      if (body.fleeAt !== undefined) policy.fleeAt = clamp(body.fleeAt, 0.05, 0.5, policy.fleeAt);
      if (typeof body.stopWhenOutOfSupplies === 'boolean') policy.stopWhenOutOfSupplies = body.stopWhenOutOfSupplies;
      if (Array.isArray(body.spellPriority)) {
        policy.spellPriority = body.spellPriority.filter((id): id is string => typeof id === 'string' && SPELLS.some((spell) => spell.id === id));
      }
      if (Array.isArray(body.disabledSpells)) {
        policy.disabledSpells = body.disabledSpells.filter((id): id is string => typeof id === 'string');
      }
      if (body.lootMinValue !== undefined) policy.lootMinValue = Math.max(0, Math.floor(Number(body.lootMinValue) || 0));
      if (body.healthPotionId !== undefined) {
        const id = Math.floor(Number(body.healthPotionId));
        policy.healthPotionId = Number.isFinite(id) ? id : 0;
      }
      if (body.manaPotionId !== undefined) {
        const id = Math.floor(Number(body.manaPotionId));
        policy.manaPotionId = Number.isFinite(id) ? id : 0;
      }
      if (typeof body.healSpellId === 'string') {
        policy.healSpellId = body.healSpellId === '' || HEAL_SPELLS.some((spell) => spell.id === body.healSpellId)
          ? body.healSpellId
          : policy.healSpellId;
      }
      if (body.healSpellAt !== undefined) policy.healSpellAt = clamp(body.healSpellAt, 0.15, 0.95, policy.healSpellAt ?? 0.7);
      if (typeof body.magicShield === 'boolean') policy.magicShield = body.magicShield;
      if (body.magicShieldAt !== undefined) policy.magicShieldAt = clamp(body.magicShieldAt, 0.1, 0.95, policy.magicShieldAt ?? 0.4);
      if (typeof body.autoAttack === 'boolean') policy.autoAttack = body.autoAttack;
      if (typeof body.taunt === 'boolean') policy.taunt = body.taunt;
      if (typeof body.lootToWarehouse === 'boolean') policy.lootToWarehouse = body.lootToWarehouse;
      if (typeof body.haste === 'boolean') policy.haste = body.haste;
      if (typeof body.food === 'boolean') policy.food = body.food;
      if (typeof body.cure === 'boolean') policy.cure = body.cure;
      if (body.runeId !== undefined) {
        const id = Math.floor(Number(body.runeId));
        if (!Number.isFinite(id)) {
          // keep current
        } else if (id < 0) {
          policy.runeId = -1;
        } else if (id === 0) {
          policy.runeId = 0;
        } else if (runeById(id)) {
          policy.runeId = id;
        }
      }
      if (body.soulRuneId !== undefined) {
        const id = Math.floor(Number(body.soulRuneId));
        if (Number.isFinite(id)) policy.soulRuneId = id < 0 ? -1 : id === 0 ? 0 : id === 3195 ? 3195 : policy.soulRuneId;
      }
      if (body.supportRuneId !== undefined) {
        const id = Math.floor(Number(body.supportRuneId));
        if (Number.isFinite(id)) policy.supportRuneId = id < 0 ? -1 : id === 0 ? 0 : id === 3203 ? 3203 : policy.supportRuneId;
      }
      if (typeof body.virtueHarmony === 'boolean') policy.virtueHarmony = body.virtueHarmony;
      if (typeof body.focusHarmony === 'boolean') policy.focusHarmony = body.focusHarmony;
      if (typeof body.familiar === 'boolean') policy.familiar = body.familiar;
      if (typeof body.bloodRage === 'boolean') policy.bloodRage = body.bloodRage;
      if (typeof body.protector === 'boolean') policy.protector = body.protector;
      if (typeof body.sharpshooter === 'boolean') policy.sharpshooter = body.sharpshooter;
      if (body.spiritPotionId !== undefined) {
        const id = Math.floor(Number(body.spiritPotionId));
        policy.spiritPotionId = Number.isFinite(id) ? id : -1;
      }
      if (body.helperReset === true) {
        const fresh = clonePolicy(DEFAULT_POLICY);
        if (mode === 'hunt') {
          character.policy = fresh;
        } else {
          character.helperProfiles[mode] = fresh;
        }
      }
      if (body.helperCopyFrom === 'hunt' && mode !== 'hunt') {
        character.helperProfiles[mode] = clonePolicy(character.policy);
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'train-online': {
      if (loaded.session?.status === 'active' || db.queuedHunt(loaded.row.id)) {
        throw new GameError('Saia da hunt para treinar online.', 400);
      }
      const elapsedMs = Math.min(Math.max(0, Math.floor(Number(body.elapsedMs ?? onlineTrainIntervalMs(character)))), 30_000);
      const gained = trainOnline(character, elapsedMs);
      persist(db, loaded, now);
      return { loaded, extra: { gained, intervalMs: onlineTrainIntervalMs(character) } };
    }

    case 'onboard': {
      const step = Number(body.step);
      if (!Number.isInteger(step) || step < 0) throw new GameError('Invalid step.');
      character.onboardingStep = Math.min(99, step);
      persist(db, loaded, now);
      return { loaded };
    }

    case 'tutorial-start': {
      if ((character.onboardingStep ?? 0) !== 0) return { loaded };
      character.onboardingStep = 1;
      if (!loaded.session && !db.queuedHunt(loaded.row.id)) {
        const hunts = listHunts(character, db);
        const hunt = hunts.find((entry) => entry.id === TUTORIAL_HUNT_ID && entry.unlocked)
          ?? hunts.find((entry) => entry.unlocked);
        if (hunt) {
          try {
            tryStartOrQueue(db, loaded, hunt.id, now);
          } catch {
            // Keep the tip even if the first cave cannot start yet.
          }
        }
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'roleta-spin': {
      const rng = new Rng(now ^ loaded.row.id ^ (character.coins ?? 0));
      const result = spinRoulette(character, rng);
      if (!result.ok) throw new GameError(result.reason, result.reason.includes('Depot') ? 409 : 402);
      persist(db, loaded, now);
      return {
        loaded,
        extra: {
          itemId: result.itemId,
          itemName: result.itemName,
          levelRequired: result.levelRequired,
          cost: ROULETTE_SPIN_COST,
          poolSize: roulettePool(character.vocationId).length,
        },
      };
    }

    case 'wheel': {
      if (character.level < WHEEL_UNLOCK_LEVEL) throw new GameError(`Wheel unlocks at level ${WHEEL_UNLOCK_LEVEL}.`, 409);
      const node = String(body.node ?? '');
      if (!WHEEL_NODES.some((entry) => entry.id === node)) throw new GameError('Unknown wheel node.');
      requireIdle(loaded);
      if (wheelPointsLeft(character) < 1) throw new GameError('No wheel points left.', 402);
      const rank = character.wheel[node] ?? 0;
      if (rank >= WHEEL_RANK_CAP) throw new GameError('That node is maxed.', 409);
      character.wheel[node] = rank + 1;
      persist(db, loaded, now);
      return { loaded };
    }

    case 'boss-slot': {
      const monsterId = String(body.monsterId ?? '');
      const monster = monstersById.get(monsterId);
      if (!monster?.isBoss) throw new GameError('That is not a boss.');
      const race = monster.bosstiaryRace;
      if (!race) throw new GameError('That boss has no Bosstiary entry.');
      const kills = character.bosstiary?.[monsterId] ?? 0;
      if (bossStage(kills, race) < 1) throw new GameError('Reach Base stage on this boss first.');
      const cap = bossSlotCap(character.bosstiary);
      if (cap < 1) throw new GameError('Unlock a Bosstiary stage first.');
      const current = [...(character.bossSlots ?? [])];
      if (current.includes(monsterId)) {
        character.bossSlots = current.filter((id) => id !== monsterId);
      } else {
        character.bossSlots = [...current.filter((id) => id !== monsterId), monsterId].slice(-cap);
      }
      persist(db, loaded, now);
      return { loaded };
    }

    case 'redeem': {
      const code = String(body.code ?? '').trim().toUpperCase();
      const row = db.findRedeemCode(code);
      if (!row) throw new GameError('Unknown code.', 404);
      if (row['used_by']) throw new GameError('Code already used.', 409);
      character.coins += Number(row['coins']) || 0;
      character.gold += Number(row['gold']) || 0;
      const vipDays = Number(row['vip_days']) || 0;
      if (vipDays > 0) {
        character.premium = true;
        character.vipUntil = Math.max(character.vipUntil ?? 0, now) + vipDays * 86_400_000;
      }
      db.useRedeemCode(code, loaded.row.accountId);
      persist(db, loaded, now);
      return { loaded, extra: { coins: Number(row['coins']) || 0, gold: Number(row['gold']) || 0 } };
    }

    case 'buy-coins': {
      const pack = COIN_PACKS.find((entry) => entry.id === String(body.pack ?? ''));
      if (!pack) throw new GameError('Unknown coin pack.');
      const orderId = db.createCoinOrder(loaded.row.accountId, pack.id, pack.coins, pack.brl);
      return { loaded, extra: { orderId, pack, pix: `TIBIA-IDLE-${orderId}` } };
    }

    case 'chat': {
      const muted = db.muteUntil(loaded.row.accountId);
      if (muted) throw new GameError(`Muted until ${new Date(muted.until).toISOString()}: ${muted.reason}`, 403);
      const channel = String(body.channel ?? 'geral');
      const text = String(body.body ?? '').trim().slice(0, 200);
      if (!text) throw new GameError('Empty message.');
      if (!['geral', 'help', 'market', 'guild'].includes(channel)) throw new GameError('Unknown channel.');
      db.insertChat(channel, character.name, text);
      return { loaded };
    }

    default:
      throw new GameError('Unknown action.');
  }
}

export function worldSnapshot(db: Database, channel = 'geral') {
  const rows = db.allCharacters();
  const parsed = rows.map((row) => {
    const state = JSON.parse(row.state) as CharacterState;
    return { row, state };
  });

  const ranks = {
    level: [...parsed].sort((a, b) => b.state.level - a.state.level || b.state.experience - a.state.experience).slice(0, 20)
      .map((entry) => ({ id: entry.row.id, name: entry.state.name, value: entry.state.level, extra: entry.state.experience })),
    gold: [...parsed].sort((a, b) => b.state.gold - a.state.gold).slice(0, 20)
      .map((entry) => ({ id: entry.row.id, name: entry.state.name, value: entry.state.gold })),
    bestiary: [...parsed].sort((a, b) => charmPointsEarned(b.state) - charmPointsEarned(a.state)).slice(0, 20)
      .map((entry) => ({ id: entry.row.id, name: entry.state.name, value: charmPointsEarned(entry.state) })),
    skill: [...parsed].sort((a, b) => combatSkill(b.state) - combatSkill(a.state) || b.state.level - a.state.level).slice(0, 20)
      .map((entry) => ({ id: entry.row.id, name: entry.state.name, value: combatSkill(entry.state), extra: entry.state.level })),
  };

  const market = db.listMarket().map((listing) => ({
    id: Number(listing['id']),
    seller: String(listing['seller_name']),
    itemId: Number(listing['item_id']),
    name: itemsById.get(Number(listing['item_id']))?.name ?? 'item',
    count: Number(listing['count']),
    price: Number(listing['price']),
    currency: String(listing['currency']),
  }));

  const live = new Set(onlineCharacterIds());
  const online = parsed.filter((entry) => live.has(entry.row.id)).map((entry) => ({
    id: entry.row.id,
    name: entry.state.name,
    level: entry.state.level,
    vocation: entry.state.vocationId,
  }));

  const guilds = db.listGuilds().map((guild) => ({
    id: Number(guild['id']),
    name: String(guild['name']),
    motd: String(guild['motd']),
    leaderId: Number(guild['leader_id']),
    members: db.guildMembers(Number(guild['id'])).map((member) => ({
      characterId: Number(member['character_id']),
      name: String(member['character_name']),
      rank: String(member['rank']),
    })),
  }));

  const chat = db.listChat(channel).reverse().map((message) => ({
    id: Number(message['id']),
    channel: String(message['channel']),
    author: String(message['author']),
    body: String(message['body']),
    at: Number(message['created_at']),
  }));

  const arena = db.listArena().map((fight) => ({
    attacker: String(fight['attacker']),
    defender: String(fight['defender']),
    winner: String(fight['winner']),
    gold: Number(fight['gold']),
  }));

  const npc = MARKET_CATALOG.map((category) => ({
    id: category.id,
    label: category.label,
    items: category.items
      .map((name) => itemsByName.get(name))
      .filter((item): item is NonNullable<typeof item> => Boolean(item && marketBuyPrice(item) !== null))
      .map((item) => ({
        id: item.id,
        name: item.name,
        buyPrice: marketBuyPrice(item)!,
        sellPrice: item.sellPrice,
        levelRequired: item.levelRequired,
        category: category.id,
      })),
  })).filter((category) => category.items.length > 0);

  return {
    ranks,
    market,
    online,
    guilds,
    chat,
    arena,
    catalogs: {
      imbuements: IMBUEMENTS,
      decorations: DECORATIONS,
      shop: SHOP,
      npc,
      charms,
      wheel: WHEEL_NODES,
      packs: COIN_PACKS,
    },
    event: getWorldEvent(),
    boosted: dailyBoostedMonster(Date.now()),
  };
}

