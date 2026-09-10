import {
  LOOT_SLOT_CAP,
  LOOT_SLOT_DEFAULT,
  LOOT_SLOT_STEP,
  Rng,
  SUPPLY_SLOT_CAP,
  SUPPLY_SLOT_DEFAULT,
  SUPPLY_SLOT_STEP,
  bestLoadout,
  createCharacter,
  deriveStats,
  emptyPreySlot,
  loadoutCost,
  spinRoulette,
  type CharacterState,
  type HuntSession,
} from '@tibia-idle/sim';
import type { Database } from './db.js';
import { describeCharacter, loadCharacter, type LoadedCharacter } from './game.js';
import { GameError } from './settle.js';
import { act as rawAct, type ActBody } from './systems.js';

const MARKET_SELLER_RATE = 0.95;
const PARTY_GOLD_COSTS = [25_000, 150_000] as const;
const POUCH_BASE_GOLD = 10_000;
const POUCH_GROWTH = 1.4;
const ROULETTE_TICKET_COST = 1;
const PREMIUM_CHARACTER_SLOT_COST = 200;
const FREE_CHARACTER_SLOTS = 4;
const MAX_CHARACTER_SLOTS = 8;
const PLAYABLE_VOCATIONS = new Set([4, 3, 1, 2, 9]);
const STARTING_GOLD = 10_000;
const STARTING_GEAR_BUDGET = 3_000;
const ROULETTE_TICKET_KEY = (accountId: number) => `roulette-tickets:${accountId}`;
const DAILY_KEY = (accountId: number) => `daily:${accountId}`;
const VIP_KEY = (accountId: number) => `vip:${accountId}`;
const SLOT_KEY = (accountId: number) => `slots:${accountId}`;

type EconomyActResult = {
  loaded: LoadedCharacter;
  targetLoaded?: LoadedCharacter;
  extra?: Record<string, unknown>;
};

function parseAuthoritative(row: ReturnType<Database['findCharacter']>): {
  state: CharacterState;
  session: HuntSession | null;
  character: CharacterState;
} | null {
  if (!row) return null;
  const state = JSON.parse(row.state) as CharacterState;
  const session = row.session ? JSON.parse(row.session) as HuntSession : null;
  return { state, session, character: session?.character ?? state };
}

function saveLoaded(db: Database, loaded: LoadedCharacter, now: number): void {
  db.saveCharacter(
    loaded.row.id,
    JSON.stringify(loaded.character),
    loaded.session ? JSON.stringify(loaded.session) : null,
    now,
  );
}

function saveAuthoritative(
  db: Database,
  row: NonNullable<ReturnType<Database['findCharacter']>>,
  parsed: NonNullable<ReturnType<typeof parseAuthoritative>>,
  now: number,
): void {
  if (parsed.session) {
    parsed.state.gold = parsed.character.gold;
    parsed.state.coins = parsed.character.coins;
    parsed.state.premium = parsed.character.premium;
    parsed.state.vipUntil = parsed.character.vipUntil;
  }
  db.saveCharacter(
    row.id,
    JSON.stringify(parsed.state),
    parsed.session ? JSON.stringify(parsed.session) : null,
    now,
  );
}

function accountVipUntil(db: Database, accountId: number): number {
  const value = Number(db.getWorld(VIP_KEY(accountId)) ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function applyVipToCharacter(character: CharacterState, vipUntil: number, now: number): boolean {
  let changed = character.vipUntil !== vipUntil || character.premium !== (vipUntil > now);
  character.vipUntil = vipUntil;
  character.premium = vipUntil > now;
  if (character.premium) {
    while (character.prey.length < 4) {
      character.prey.push(emptyPreySlot(now));
      changed = true;
    }
  }
  return changed;
}

function propagateVip(db: Database, accountId: number, vipUntil: number, now: number): void {
  db.setWorld(VIP_KEY(accountId), String(vipUntil));
  for (const row of db.charactersForAccount(accountId)) {
    const parsed = parseAuthoritative(row);
    if (!parsed) continue;
    applyVipToCharacter(parsed.state, vipUntil, now);
    if (parsed.session) applyVipToCharacter(parsed.session.character, vipUntil, now);
    db.saveCharacter(
      row.id,
      JSON.stringify(parsed.state),
      parsed.session ? JSON.stringify(parsed.session) : null,
      now,
    );
  }
}

export function economyCharacterSlotCap(db: Database, accountId: number): number {
  const boughtRaw = Number(db.getWorld(SLOT_KEY(accountId)) ?? 0);
  const bought = Number.isFinite(boughtRaw) ? Math.max(0, Math.floor(boughtRaw)) : 0;
  const configured = Math.min(MAX_CHARACTER_SLOTS, FREE_CHARACTER_SLOTS + bought);
  // Grandfather existing accounts that already used the previous fifth free slot.
  const existing = Math.min(MAX_CHARACTER_SLOTS, db.charactersForAccount(accountId).length);
  return Math.max(configured, existing);
}

export function economyCreateNewCharacter(
  db: Database,
  accountId: number,
  name: string,
  vocationId: number,
  options: { gender?: 'm' | 'f'; weapon?: 'axe' | 'sword' | 'club' } = {},
  now = Date.now(),
): LoadedCharacter {
  if (!/^[a-zA-Z][a-zA-Z ']{2,19}$/.test(name)) {
    throw new GameError('Names are 3-20 characters and start with a letter.');
  }
  if (!PLAYABLE_VOCATIONS.has(vocationId)) throw new GameError('Pick one of the five starting vocations.');
  if (db.findCharacterByName(name)) throw new GameError('That name is taken.', 409);
  if (db.charactersForAccount(accountId).length >= economyCharacterSlotCap(db, accountId)) {
    throw new GameError(`An account holds at most ${economyCharacterSlotCap(db, accountId)} characters.`, 409);
  }

  const character = createCharacter(name, vocationId);
  // Premium currency is never minted by character creation.
  character.coins = 0;
  character.gender = options.gender === 'f' ? 'f' : 'm';
  character.startWeapon = options.weapon === 'axe' || options.weapon === 'club' ? options.weapon : 'sword';
  if (vocationId === 4) character.skills[character.startWeapon].level = 12;
  character.gold = STARTING_GOLD;
  character.equipment = bestLoadout(character, STARTING_GEAR_BUDGET);
  character.gold -= loadoutCost(character.equipment);
  const stats = deriveStats(character);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  const vipUntil = accountVipUntil(db, accountId);
  if (vipUntil > 0) applyVipToCharacter(character, vipUntil, now);

  const row = db.createCharacter(accountId, name, vocationId, JSON.stringify(character));
  return { row, character, session: null };
}

export function finalizeNewCharacterEconomy(
  db: Database,
  accountId: number,
  loaded: LoadedCharacter,
  now = Date.now(),
): LoadedCharacter {
  loaded.character.coins = 0;
  const vipUntil = accountVipUntil(db, accountId);
  if (vipUntil > 0) applyVipToCharacter(loaded.character, vipUntil, now);
  saveLoaded(db, loaded, now);
  return loaded;
}

function legacyAccountDaily(db: Database, accountId: number): { day: string; streak: number } {
  let best = { day: '', streak: 0 };
  for (const row of db.charactersForAccount(accountId)) {
    const parsed = parseAuthoritative(row);
    if (!parsed) continue;
    const day = parsed.character.dailyClaim ?? '';
    const streak = Math.max(0, Math.min(7, Math.floor(parsed.character.dailyStreak ?? 0)));
    if (day > best.day || (day === best.day && streak > best.streak)) best = { day, streak };
  }
  return best;
}

function accountDaily(db: Database, accountId: number): { day: string; streak: number } {
  const raw = db.getWorld(DAILY_KEY(accountId));
  if (!raw) return legacyAccountDaily(db, accountId);
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; streak?: unknown };
    return {
      day: typeof parsed.day === 'string' ? parsed.day : '',
      streak: Math.max(0, Math.min(7, Math.floor(Number(parsed.streak) || 0))),
    };
  } catch {
    return legacyAccountDaily(db, accountId);
  }
}

function claimAccountDaily(
  db: Database,
  accountId: number,
  characterId: number,
  body: ActBody,
  now: number,
): EconomyActResult {
  const day = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const previous = accountDaily(db, accountId);
  if (previous.day === day) throw new GameError('Daily already claimed on this account today.', 409);

  const streak = previous.day === yesterday
    ? (previous.streak >= 7 ? 1 : previous.streak + 1)
    : 1;
  const desiredGold = 400 * streak;

  const result = rawAct(db, accountId, characterId, body, now);
  const rawGold = Number(result.extra?.gold ?? 0);
  const rawCoins = Number(result.extra?.coins ?? 0);
  result.loaded.character.gold += desiredGold - rawGold;
  result.loaded.character.coins = Math.max(0, result.loaded.character.coins - rawCoins);
  result.loaded.character.dailyClaim = day;
  result.loaded.character.dailyStreak = streak;

  let tickets = Number(db.getWorld(ROULETTE_TICKET_KEY(accountId)) ?? 0) || 0;
  const rouletteTickets = streak === 7 ? 1 : 0;
  tickets += rouletteTickets;
  db.setWorld(ROULETTE_TICKET_KEY(accountId), String(tickets));
  db.setWorld(DAILY_KEY(accountId), JSON.stringify({ day, streak }));
  saveLoaded(db, result.loaded, now);

  return {
    ...result,
    extra: { ...(result.extra ?? {}), gold: desiredGold, coins: 0, streak, rouletteTickets, ticketBalance: tickets },
  };
}

function spinWithTicket(db: Database, accountId: number, characterId: number, now: number): EconomyActResult {
  const tickets = Math.max(0, Number(db.getWorld(ROULETTE_TICKET_KEY(accountId)) ?? 0) || 0);
  if (tickets < ROULETTE_TICKET_COST) throw new GameError('Precisa de 1 Ticket de Roleta. Complete o 7º Daily para ganhar um.', 402);

  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const originalCoins = loaded.character.coins;
  loaded.character.coins = Math.max(originalCoins, 75);
  const rng = new Rng(BigInt(now) ^ BigInt(loaded.row.id) ^ BigInt(tickets));
  const result = spinRoulette(loaded.character, rng);
  loaded.character.coins = originalCoins;
  if (!result.ok) throw new GameError(result.reason, result.reason.includes('Depot') ? 409 : 400);

  db.setWorld(ROULETTE_TICKET_KEY(accountId), String(tickets - ROULETTE_TICKET_COST));
  saveLoaded(db, loaded, now);
  return {
    loaded,
    extra: {
      itemId: result.itemId,
      itemName: result.itemName,
      levelRequired: result.levelRequired,
      cost: ROULETTE_TICKET_COST,
      ticketBalance: tickets - ROULETTE_TICKET_COST,
    },
  };
}

function unlockPartyWithGold(db: Database, accountId: number, characterId: number, now: number): EconomyActResult {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const slots = loaded.character.partySlots ?? 1;
  if (slots >= 3) throw new GameError('Party is full.', 409);
  const cost = PARTY_GOLD_COSTS[Math.max(0, slots - 1)] ?? PARTY_GOLD_COSTS[PARTY_GOLD_COSTS.length - 1]!;
  if (loaded.character.gold < cost) throw new GameError(`Saldo insuficiente: ${cost} gold.`, 402);
  loaded.character.gold -= cost;
  loaded.character.partySlots = slots + 1;
  saveLoaded(db, loaded, now);
  return { loaded, extra: { cost, currency: 'gold' } };
}

function pouchCost(current: number, initial: number): number {
  const purchased = Math.max(0, current - initial);
  return Math.round(POUCH_BASE_GOLD * (POUCH_GROWTH ** purchased));
}

function unlockPouchSlot(
  db: Database,
  accountId: number,
  characterId: number,
  kind: 'loot' | 'supply',
  now: number,
): EconomyActResult {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const isLoot = kind === 'loot';
  const current = isLoot
    ? (loaded.character.lootSlots ?? LOOT_SLOT_DEFAULT)
    : (loaded.character.supplySlots ?? SUPPLY_SLOT_DEFAULT);
  const cap = isLoot ? LOOT_SLOT_CAP : SUPPLY_SLOT_CAP;
  const step = isLoot ? LOOT_SLOT_STEP : SUPPLY_SLOT_STEP;
  if (current >= cap) throw new GameError(`${isLoot ? 'Loot' : 'Supply'} pouch is already maxed.`, 409);
  const cost = pouchCost(current, isLoot ? LOOT_SLOT_DEFAULT : SUPPLY_SLOT_DEFAULT);
  if (loaded.character.gold < cost) throw new GameError(`Need ${cost} gold.`, 402);
  loaded.character.gold -= cost;
  if (isLoot) loaded.character.lootSlots = Math.min(cap, current + step);
  else loaded.character.supplySlots = Math.min(cap, current + step);
  saveLoaded(db, loaded, now);
  return { loaded, extra: { cost, currency: 'gold' } };
}

function buyCharacterSlot(db: Database, accountId: number, characterId: number, now: number): EconomyActResult {
  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const currentCap = economyCharacterSlotCap(db, accountId);
  if (currentCap >= MAX_CHARACTER_SLOTS) throw new GameError('Character slots are already maxed.', 409);
  if (loaded.character.coins < PREMIUM_CHARACTER_SLOT_COST) {
    throw new GameError(`Need ${PREMIUM_CHARACTER_SLOT_COST} Knock Coins.`, 402);
  }
  loaded.character.coins -= PREMIUM_CHARACTER_SLOT_COST;
  const nextCap = currentCap + 1;
  db.setWorld(SLOT_KEY(accountId), String(nextCap - FREE_CHARACTER_SLOTS));
  saveLoaded(db, loaded, now);
  return { loaded, extra: { slots: nextCap, cost: PREMIUM_CHARACTER_SLOT_COST } };
}

export function economyAct(
  db: Database,
  accountId: number,
  characterId: number,
  body: ActBody,
  now = Date.now(),
): EconomyActResult {
  const type = String(body.type ?? '');

  if (type === 'convert') {
    throw new GameError('A conversão de gold em Knock Coins foi desativada para proteger a economia do servidor.', 409);
  }
  if (type === 'daily') return claimAccountDaily(db, accountId, characterId, body, now);
  if (type === 'roleta-spin') return spinWithTicket(db, accountId, characterId, now);
  if (type === 'party-unlock') return unlockPartyWithGold(db, accountId, characterId, now);
  if ((type === 'loot-slot' || type === 'supply-slot') && body.currency === 'coins') {
    throw new GameError('Expansões de pouch agora usam apenas gold.', 409);
  }
  if (type === 'loot-slot') return unlockPouchSlot(db, accountId, characterId, 'loot', now);
  if (type === 'supply-slot') return unlockPouchSlot(db, accountId, characterId, 'supply', now);
  if (type === 'shop' && String(body.sku ?? '') === 'char_slot') return buyCharacterSlot(db, accountId, characterId, now);

  if (type === 'transfer') {
    const target = db.findCharacterByName(String(body.name ?? '').trim());
    if (target && target.accountId !== accountId) {
      throw new GameError('Knock Coins só podem ser movidas entre personagens da mesma conta.', 403);
    }
  }

  if (type === 'market-list' && body.currency === 'coins') {
    throw new GameError('Knock Coins não podem ser usadas no Market.', 409);
  }

  let marketSeller: { id: number; gold: number; payout: number } | null = null;
  if (type === 'market-buy') {
    const listing = db.findMarket(Number(body.listingId));
    if (listing && String(listing.currency) !== 'gold') {
      throw new GameError('Anúncio antigo em Coins não pode mais ser comprado.', 409);
    }
    if (listing) {
      const sellerId = Number(listing.seller_id);
      const sellerRow = db.findCharacter(sellerId);
      const seller = parseAuthoritative(sellerRow);
      const price = Number(listing.price) || 0;
      if (seller && sellerRow) {
        marketSeller = { id: sellerId, gold: seller.character.gold ?? 0, payout: Math.floor(price * MARKET_SELLER_RATE) };
      }
    }
  }

  const result: EconomyActResult = rawAct(db, accountId, characterId, body, now);

  if (type === 'shop') {
    const sku = String(body.sku ?? '');
    if (sku.startsWith('vip')) {
      propagateVip(db, accountId, result.loaded.character.vipUntil ?? 0, now);
      result.loaded = loadCharacter(db, accountId, characterId, now).loaded;
    }
  }

  if (marketSeller) {
    const sellerRow = db.findCharacter(marketSeller.id);
    const seller = parseAuthoritative(sellerRow);
    if (seller && sellerRow) {
      seller.state.gold = marketSeller.gold + marketSeller.payout;
      seller.character.gold = marketSeller.gold + marketSeller.payout;
      saveAuthoritative(db, sellerRow, seller, now);
    }
  }

  return result;
}

export function syncAccountEconomy(db: Database, accountId: number, loaded: LoadedCharacter, now = Date.now()): LoadedCharacter {
  let changed = false;
  const vipKeyExists = db.getWorld(VIP_KEY(accountId)) !== null;
  const vipUntil = accountVipUntil(db, accountId);
  if (vipUntil > 0 || vipKeyExists) {
    changed = applyVipToCharacter(loaded.character, vipUntil, now) || changed;
    if (loaded.session && loaded.session.character !== loaded.character) {
      changed = applyVipToCharacter(loaded.session.character, vipUntil, now) || changed;
    }
  } else if ((loaded.character.vipUntil ?? 0) > now) {
    propagateVip(db, accountId, loaded.character.vipUntil, now);
    return loaded;
  }

  const daily = accountDaily(db, accountId);
  if (daily.day && (loaded.character.dailyClaim !== daily.day || loaded.character.dailyStreak !== daily.streak)) {
    loaded.character.dailyClaim = daily.day;
    loaded.character.dailyStreak = daily.streak;
    changed = true;
  }
  if (changed) saveLoaded(db, loaded, now);
  return loaded;
}

export function ticketBalance(db: Database, accountId: number): number {
  return Math.max(0, Number(db.getWorld(ROULETTE_TICKET_KEY(accountId)) ?? 0) || 0);
}

export function economyCharacterView(db: Database, accountId: number, loaded: LoadedCharacter) {
  return {
    ...describeCharacter(loaded, db),
    rouletteTickets: ticketBalance(db, accountId),
  };
}
