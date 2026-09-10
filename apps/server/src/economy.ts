import {
  LOOT_SLOT_CAP,
  LOOT_SLOT_DEFAULT,
  LOOT_SLOT_STEP,
  Rng,
  ROULETTE_SPIN_COST,
  SUPPLY_SLOT_CAP,
  SUPPLY_SLOT_DEFAULT,
  SUPPLY_SLOT_STEP,
  emptyPreySlot,
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
const ROULETTE_TICKET_KEY = (accountId: number) => `roulette-tickets:${accountId}`;
const DAILY_KEY = (accountId: number) => `daily:${accountId}`;
const VIP_KEY = (accountId: number) => `vip:${accountId}`;

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
    // Keep both snapshots aligned. The session remains authoritative while hunting.
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

function applyVipToCharacter(character: CharacterState, vipUntil: number, now: number): void {
  character.vipUntil = vipUntil;
  character.premium = vipUntil > now;
  if (character.premium) {
    while (character.prey.length < 4) character.prey.push(emptyPreySlot(now));
  }
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

/**
 * Apply account-owned economic state to a freshly created character.
 * New characters never mint premium currency, and active VIP follows the account.
 */
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

function accountDaily(db: Database, accountId: number): { day: string; streak: number } {
  const raw = db.getWorld(DAILY_KEY(accountId));
  if (!raw) return { day: '', streak: 0 };
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; streak?: unknown };
    return {
      day: typeof parsed.day === 'string' ? parsed.day : '',
      streak: Math.max(0, Math.min(7, Math.floor(Number(parsed.streak) || 0))),
    };
  } catch {
    return { day: '', streak: 0 };
  }
}

function claimAccountDaily(
  db: Database,
  accountId: number,
  characterId: number,
  body: ActBody,
  now: number,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const previous = accountDaily(db, accountId);

  // On the first claim after migration, respect a same-day claim stored on the character.
  if (!previous.day) {
    const row = db.findCharacter(characterId);
    const parsed = parseAuthoritative(row);
    if (parsed?.character.dailyClaim === day) {
      throw new GameError('Daily already claimed on this account today.', 409);
    }
  }
  if (previous.day === day) throw new GameError('Daily already claimed on this account today.', 409);

  const streak = previous.day === yesterday
    ? (previous.streak >= 7 ? 1 : previous.streak + 1)
    : 1;
  const desiredGold = 400 * streak;

  const result = rawAct(db, accountId, characterId, body, now);
  const rawGold = Number(result.extra?.gold ?? 0);
  const rawCoins = Number(result.extra?.coins ?? 0);

  // Preserve the gameplay rewards while preventing Daily from minting premium currency.
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

function spinWithTicket(db: Database, accountId: number, characterId: number, now: number) {
  const tickets = Math.max(0, Number(db.getWorld(ROULETTE_TICKET_KEY(accountId)) ?? 0) || 0);
  if (tickets < ROULETTE_SPIN_COST) throw new GameError('Precisa de 1 Ticket de Roleta. Complete o 7º Daily para ganhar um.', 402);

  const { loaded } = loadCharacter(db, accountId, characterId, now);
  const originalCoins = loaded.character.coins;
  loaded.character.coins = Math.max(originalCoins, 75);
  const rng = new Rng(now ^ loaded.row.id ^ tickets);
  const result = spinRoulette(loaded.character, rng);
  loaded.character.coins = originalCoins;
  if (!result.ok) throw new GameError(result.reason, result.reason.includes('Depot') ? 409 : 400);

  db.setWorld(ROULETTE_TICKET_KEY(accountId), String(tickets - ROULETTE_SPIN_COST));
  saveLoaded(db, loaded, now);
  return {
    loaded,
    extra: {
      itemId: result.itemId,
      itemName: result.itemName,
      levelRequired: result.levelRequired,
      cost: ROULETTE_SPIN_COST,
      ticketBalance: tickets - ROULETTE_SPIN_COST,
    },
  };
}

function unlockPartyWithGold(db: Database, accountId: number, characterId: number, now: number) {
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
) {
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

/**
 * Production economy boundary. The underlying gameplay action remains reusable,
 * while monetization-sensitive rules live in one auditable place.
 */
export function economyAct(
  db: Database,
  accountId: number,
  characterId: number,
  body: ActBody,
  now = Date.now(),
) {
  const type = String(body.type ?? '');

  if (type === 'convert') {
    throw new GameError('A conversão de gold em Knock Coins foi desativada para proteger a economia do servidor.', 409);
  }

  if (type === 'daily') return claimAccountDaily(db, accountId, characterId, body, now);
  if (type === 'roleta-spin') return spinWithTicket(db, accountId, characterId, now);
  if (type === 'party-unlock') return unlockPartyWithGold(db, accountId, characterId, now);
  if (type === 'loot-slot') return unlockPouchSlot(db, accountId, characterId, 'loot', now);
  if (type === 'supply-slot') return unlockPouchSlot(db, accountId, characterId, 'supply', now);

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

  const result = rawAct(db, accountId, characterId, body, now);

  if (type === 'shop') {
    const sku = String(body.sku ?? '');
    if (sku.startsWith('vip')) {
      propagateVip(db, accountId, result.loaded.character.vipUntil ?? 0, now);
      const refreshed = loadCharacter(db, accountId, characterId, now).loaded;
      result.loaded = refreshed;
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
  const vipUntil = accountVipUntil(db, accountId);
  if (vipUntil > 0 || db.getWorld(VIP_KEY(accountId)) !== null) {
    applyVipToCharacter(loaded.character, vipUntil, now);
    if (loaded.session) applyVipToCharacter(loaded.session.character, vipUntil, now);
  } else if ((loaded.character.vipUntil ?? 0) > now) {
    // One-time migration from the old character-scoped VIP model.
    propagateVip(db, accountId, loaded.character.vipUntil, now);
  }

  const daily = accountDaily(db, accountId);
  if (daily.day) {
    loaded.character.dailyClaim = daily.day;
    loaded.character.dailyStreak = daily.streak;
  }
  saveLoaded(db, loaded, now);
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
