import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { items } from '@tibia-idle/data';
import { createCharacter, deriveStats, startSession } from '@tibia-idle/sim';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { endHunt } from '../src/settle.js';
import { markOnline } from '../src/presence.js';

let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  ({ app, db } = await createApp({ databaseFile: ':memory:' }));
});

afterEach(async () => {
  await app.close();
});

async function post(url: string, payload: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as Record<string, unknown>,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function get(url: string, token?: string) {
  return app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function del(url: string, token?: string) {
  return app.inject({ method: 'DELETE', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function setup() {
  const token = (await post('/api/register', { username: 'sys', password: 'hunter2hunter2' })).json().token as string;
  const character = (await post('/api/characters', { name: 'Systema', vocationId: 4 }, token)).json().character as {
    id: number; gold: number; coins: number;
  };
  return { token, character };
}

function patchState(id: number, mutate: (state: Record<string, unknown>) => void) {
  const row = db.findCharacter(id)!;
  const state = JSON.parse(row.state) as Record<string, unknown>;
  mutate(state);
  db.saveCharacter(row.id, JSON.stringify(state), row.session, row.settledAt);
}

describe('systems', () => {
  it('claims the daily once', async () => {
    const { token, character } = await setup();
    const first = await post(`/api/characters/${character.id}/act`, { type: 'daily' }, token);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().gold).toBeGreaterThan(0);
    expect(first.json().character.dailyStreak).toBe(1);
    expect(first.json().character.xpBoostUntil).toBeGreaterThan(Date.now());

    const again = await post(`/api/characters/${character.id}/act`, { type: 'daily' }, token);
    expect(again.statusCode).toBe(409);
  });

  it('rolls a prey slot', async () => {
    const { token, character } = await setup();
    const list = await post(`/api/characters/${character.id}/act`, { type: 'prey-list-reroll', slot: 0 }, token);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().character.prey[0].candidates?.length).toBeGreaterThan(0);

    const monsterId = list.json().character.prey[0].candidates[0];
    const select = await post(`/api/characters/${character.id}/act`, { type: 'prey-select', slot: 0, monsterId }, token);
    expect(select.statusCode, select.body).toBe(200);
    expect(select.json().character.prey[0].monsterId).toBeTruthy();
  });

  it('converts gold into coins and buys VIP', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 3_000_000;
      state.coins = 0;
    });
    const converted = await post(`/api/characters/${character.id}/act`, { type: 'convert', gold: 2_500_000 }, token);
    expect(converted.statusCode, converted.body).toBe(200);
    expect(converted.json().character.coins).toBe(250);

    const vip = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'vip7' }, token);
    expect(vip.statusCode, vip.body).toBe(200);
    expect(vip.json().character.premium).toBe(true);
    expect(vip.json().character.prey.length).toBe(4);
  });

  it('lists and buys on the market', async () => {
    const item = items.find((entry) => (entry.sellPrice ?? 0) > 0)!;
    const seller = await setup();
    patchState(seller.character.id, (state) => {
      state.warehouse = [{ itemId: item.id, count: 2 }];
    });
    const listed = await post(`/api/characters/${seller.character.id}/act`, {
      type: 'market-list', itemId: item.id, count: 1, price: 50, currency: 'gold',
    }, seller.token);
    expect(listed.statusCode, listed.body).toBe(200);

    const buyerToken = (await post('/api/register', { username: 'buyer', password: 'hunter2hunter2' })).json().token as string;
    const buyer = (await post('/api/characters', { name: 'Comprador', vocationId: 1 }, buyerToken)).json().character as { id: number };
    patchState(buyer.id, (state) => { state.gold = 10_000; });

    const world = await get('/api/world', buyerToken);
    const listing = (world.json().market as Array<{ id: number }>)[0];
    expect(listing).toBeDefined();

    const bought = await post(`/api/characters/${buyer.id}/act`, { type: 'market-buy', listingId: listing!.id }, buyerToken);
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().character.warehouse.some((stack: { itemId: number }) => stack.itemId === item.id)
      || bought.json().character.backpackContents?.some((stack: { itemId: number }) => stack.itemId === item.id)).toBe(true);
  });

  it('creates a guild and appears on the rank', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => { state.gold = 80_000; });
    const created = await post(`/api/characters/${character.id}/act`, { type: 'guild-create', name: 'Dragons' }, token);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().character.guildId).toBeTruthy();

    const world = await get('/api/world', token);
    expect(world.json().guilds[0].name).toBe('Dragons');
    expect(world.json().ranks.level[0].name).toBe('Systema');
  });

  it('fights in the arena', async () => {
    const a = await setup();
    const tokenB = (await post('/api/register', { username: 'foe', password: 'hunter2hunter2' })).json().token as string;
    const b = (await post('/api/characters', { name: 'Rivalis', vocationId: 1 }, tokenB)).json().character as { id: number };

    const fight = await post(`/api/characters/${a.character.id}/act`, { type: 'arena', defenderId: b.id }, a.token);
    expect(fight.statusCode, fight.body).toBe(200);
    expect(typeof fight.json().won).toBe('boolean');
  });

  it('saves hunt policy', async () => {
    const { token, character } = await setup();
    const response = await post(`/api/characters/${character.id}/act`, {
      type: 'policy',
      lootMinValue: 50,
      healthPotionAt: 0.75,
      spellPriority: ['brutal_strike'],
    }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.policy.lootMinValue).toBe(50);
    expect(response.json().character.policy.spellPriority).toEqual(['brutal_strike']);
    expect(response.json().character.policy.healSpellId).toBe('wound_cleansing');
  });

  it('saves helper healing and shield', async () => {
    const { token, character } = await setup();
    const response = await post(`/api/characters/${character.id}/act`, {
      type: 'policy',
      healSpellId: 'wound_cleansing',
      healSpellAt: 0.7,
      magicShield: true,
      magicShieldAt: 0.4,
      autoAttack: false,
      taunt: true,
    }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.policy).toMatchObject({
      healSpellId: 'wound_cleansing',
      healSpellAt: 0.7,
      magicShield: true,
      autoAttack: false,
      taunt: true,
    });
  });

  it('saves haste, food and rune policy', async () => {
    const { token, character } = await setup();
    const response = await post(`/api/characters/${character.id}/act`, {
      type: 'policy',
      haste: true,
      food: false,
      runeId: 3198,
    }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.policy).toMatchObject({
      haste: true,
      food: false,
      runeId: 3198,
    });
  });

  it('starts the tutorial hunt for a new character', async () => {
    const { token, character } = await setup();
    const response = await post(`/api/characters/${character.id}/act`, { type: 'tutorial-start' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.onboardingStep).toBe(1);
    expect(response.json().character.session).toBeTruthy();
    expect(response.json().character.session.huntId).toBe('venore-rotworm-cave');
  });

  it('buys one loot pouch slot at escalating gold cost', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 35_000;
    });
    const first = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'gold' }, token);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().character.lootSlots).toBe(21);
    expect(first.json().character.gold).toBe(25_000);

    const second = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'gold' }, token);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().character.lootSlots).toBe(22);
    expect(second.json().character.gold).toBe(5_000);
  });

  it('buys one supply pouch slot at escalating gold cost', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 25_000;
    });
    const response = await post(`/api/characters/${character.id}/act`, { type: 'supply-slot', currency: 'gold' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.supplySlots).toBe(21);
    expect(response.json().character.gold).toBe(15_000);
  });

  it('buys one loot pouch slot with Tibia Coins', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.coins = 50;
    });
    const response = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'coins' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.lootSlots).toBe(21);
    expect(response.json().character.coins).toBe(40);
    expect(response.json().character.lootSlotCoinCost).toBe(10);
  });

  it('keeps loot pouch TC cost flat after gold slot purchases', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 35_000;
      state.coins = 50;
    });
    const firstGold = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'gold' }, token);
    expect(firstGold.statusCode, firstGold.body).toBe(200);
    const secondGold = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'gold' }, token);
    expect(secondGold.statusCode, secondGold.body).toBe(200);
    expect(secondGold.json().character.lootSlotCost).toBe(40_000);
    expect(secondGold.json().character.lootSlotCoinCost).toBe(10);

    const withCoins = await post(`/api/characters/${character.id}/act`, { type: 'loot-slot', currency: 'coins' }, token);
    expect(withCoins.statusCode, withCoins.body).toBe(200);
    expect(withCoins.json().character.lootSlots).toBe(23);
    expect(withCoins.json().character.coins).toBe(40);
    expect(withCoins.json().character.lootSlotCoinCost).toBe(10);
  });

  it('saves and loads an appearance preset', async () => {
    const { token, character } = await setup();
    const saved = await post(`/api/characters/${character.id}/act`, { type: 'preset-save', slot: 0 }, token);
    expect(saved.statusCode, saved.body).toBe(200);
    await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'colors' }, token);
    const loaded = await post(`/api/characters/${character.id}/act`, { type: 'preset-load', slot: 0 }, token);
    expect(loaded.statusCode, loaded.body).toBe(200);
    expect(loaded.json().character.appearance).toEqual(saved.json().character.appearancePresets[0]);
  });

  it('unlocks a decoration', async () => {
    const { token, character } = await setup();
    const response = await post(`/api/characters/${character.id}/act`, { type: 'decorate', decoration: 'torch' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.decorations).toContain('torch');
  });

  it('spins the vocation roulette for 75 TC and stores the prize in the depot', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.coins = 100;
      state.warehouse = [];
    });
    const response = await post(`/api/characters/${character.id}/act`, { type: 'roleta-spin' }, token);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.character.coins).toBe(25);
    expect(typeof body.itemId).toBe('number');
    expect(typeof body.itemName).toBe('string');
    expect(body.character.warehouse.some((stack: { itemId: number }) => stack.itemId === body.itemId)).toBe(true);
  });

  it('allows roulette spin while a hunt session is active', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.coins = 100;
      state.warehouse = [];
    });
    await post(`/api/characters/${character.id}/hunt`, { huntId: 'venore-rotworm-cave' }, token);
    const response = await post(`/api/characters/${character.id}/act`, { type: 'roleta-spin' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.coins).toBe(25);
  });

  it('spends a wheel point after level 50', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.level = 60;
    });
    const response = await post(`/api/characters/${character.id}/act`, { type: 'wheel', node: 'combat' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.wheel.combat).toBe(1);
    expect(response.json().character.wheelLeft).toBe(9);
  });

  it('redeems an admin code and fulfills a coin order', async () => {
    const adminToken = (await post('/api/register', { username: 'admin', password: 'hunter2hunter2' })).json().token as string;
    const { token, character } = await setup();

    const created = await post('/api/admin', { type: 'code', code: 'BETA-100', coins: 100, gold: 0, vipDays: 0 }, adminToken);
    expect(created.statusCode, created.body).toBe(200);

    const redeemed = await post(`/api/characters/${character.id}/act`, { type: 'redeem', code: 'BETA-100' }, token);
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect(redeemed.json().character.coins).toBeGreaterThanOrEqual(100);

    const order = await post(`/api/characters/${character.id}/act`, { type: 'buy-coins', pack: 'pack50' }, token);
    expect(order.statusCode, order.body).toBe(200);
    expect(order.json().orderId).toBeTruthy();

    const paid = await post('/api/admin', { type: 'fulfill', orderId: order.json().orderId }, adminToken);
    expect(paid.statusCode, paid.body).toBe(200);

    const forbidden = await post('/api/admin', { type: 'grant', characterId: character.id, gold: 1 }, token);
    expect(forbidden.statusCode).toBe(403);
  });

  it('records telemetry and exposes economy metrics', async () => {
    const { token, character } = await setup();
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((hunt) => hunt.unlocked)!.id }, token);

    const adminToken = (await post('/api/register', { username: 'admin', password: 'hunter2hunter2' })).json().token as string;
    const panel = await get('/api/admin', adminToken);
    expect(panel.statusCode, panel.body).toBe(200);
    const metrics = panel.json().metrics as { last24h: { registers: number; huntsStarted: number }; accounts: number };
    expect(metrics.accounts).toBeGreaterThanOrEqual(2);
    expect(metrics.last24h.registers).toBeGreaterThanOrEqual(2);
    expect(metrics.last24h.huntsStarted).toBeGreaterThanOrEqual(1);
  });

  it('keeps registration closed until an invite is used', async () => {
    const adminToken = (await post('/api/register', { username: 'admin', password: 'hunter2hunter2' })).json().token as string;
    expect((await post('/api/admin', { type: 'beta', open: false }, adminToken)).statusCode).toBe(200);
    expect((await post('/api/register', { username: 'locked', password: 'hunter2hunter2' })).statusCode).toBe(403);

    const invite = await post('/api/admin', { type: 'invite', code: 'IN-OK' }, adminToken);
    expect(invite.statusCode, invite.body).toBe(200);
    const allowed = await post('/api/register', { username: 'guest', password: 'hunter2hunter2', invite: 'IN-OK' });
    expect(allowed.statusCode, allowed.body).toBe(200);

    const health = await get('/api/health');
    expect(health.json().beta).toBe('closed');

    const guest = await post('/api/guest', {});
    expect(guest.statusCode, guest.body).toBe(200);
    expect(guest.json().guest).toBe(true);
  });

  it('applies shop cosmetics and transfers coins', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => { state.coins = 500; });
    const aura = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'aura_gold' }, token);
    expect(aura.statusCode, aura.body).toBe(200);
    expect(aura.json().character.appearance.aura).toBe(1);
    expect(aura.json().character.coins).toBe(380);

    const otherToken = (await post('/api/register', { username: 'payee', password: 'hunter2hunter2' })).json().token as string;
    const other = (await post('/api/characters', { name: 'Payee', vocationId: 1 }, otherToken)).json().character as { id: number; coins: number };
    const sent = await post(`/api/characters/${character.id}/act`, { type: 'transfer', name: 'Payee', coins: 20 }, token);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().character.coins).toBe(360);
    const received = await get(`/api/characters/${other.id}`, otherToken);
    expect(received.json().character.coins).toBe(other.coins + 20);
  });

  it('buys store boosts and unlocks outfits without repurchase', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => { state.coins = 1000; });
    const boost = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'xp_boost_1h' }, token);
    expect(boost.statusCode, boost.body).toBe(200);
    expect(boost.json().character.storeBoosts.xp.bonus).toBeGreaterThan(0);
    expect(boost.json().character.storeBoosts.xp.until).toBeGreaterThan(Date.now());

    const outfit = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'outfit_champion' }, token);
    expect(outfit.statusCode, outfit.body).toBe(200);
    expect(outfit.json().character.unlockedOutfits).toEqual(expect.arrayContaining([633, 632]));

    const again = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'outfit_champion' }, token);
    expect(again.statusCode).toBe(409);
  });

  it('buys a mount and unlocks it with real server id', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => { state.coins = 1000; });
    const bought = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'mount_armoured_war_horse' }, token);
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().character.unlockedMounts).toContain(23);
    expect(bought.json().character.appearance.mount).toBe(23);
    expect(bought.json().character.coins).toBe(130);

    const again = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'mount_armoured_war_horse' }, token);
    expect(again.statusCode).toBe(409);
  });

  it('sells extra character slots', async () => {
    const { token, character } = await setup();
    expect((await post('/api/characters', { name: 'Second', vocationId: 1 }, token)).statusCode).toBe(201);
    expect((await post('/api/characters', { name: 'Third', vocationId: 2 }, token)).statusCode).toBe(201);
    expect((await post('/api/characters', { name: 'Fourth', vocationId: 3 }, token)).statusCode).toBe(201);
    expect((await post('/api/characters', { name: 'Fifth', vocationId: 4 }, token)).statusCode).toBe(201);
    expect((await post('/api/characters', { name: 'Sixth', vocationId: 1 }, token)).statusCode).toBe(409);

    patchState(character.id, (state) => { state.coins = 200; });
    const bought = await post(`/api/characters/${character.id}/act`, { type: 'shop', sku: 'char_slot' }, token);
    expect(bought.statusCode).toBe(409);
  });

  it('ranks skill and lists hunters as online', async () => {
    const { token, character } = await setup();
    const idle = await get('/api/world', token);
    expect(idle.json().ranks.skill[0].name).toBe('Systema');
    expect(idle.json().online).toEqual([]);

    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((hunt) => hunt.unlocked)!.id }, token);
    markOnline(character.id);
    const live = await get('/api/world', token);
    expect(live.json().online.some((row: { name: string }) => row.name === 'Systema')).toBe(true);
  });

  it('buys fewer supplies for a 1 hour trip than for 8 hours', async () => {
    const tokenA = (await post('/api/register', { username: 'short', password: 'hunter2hunter2' })).json().token as string;
    const tokenB = (await post('/api/register', { username: 'longh', password: 'hunter2hunter2' })).json().token as string;
    const a = (await post('/api/characters', { name: 'Curto', vocationId: 4 }, tokenA)).json().character as { id: number };
    const b = (await post('/api/characters', { name: 'Longo', vocationId: 4 }, tokenB)).json().character as { id: number };
    patchState(a.id, (state) => { state.gold = 80_000; });
    patchState(b.id, (state) => { state.gold = 80_000; });
    const hunts = (await get(`/api/characters/${a.id}/hunts`, tokenA)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const huntId = hunts.find((hunt) => hunt.unlocked)!.id;
    const shortTrip = await post(`/api/characters/${a.id}/hunt`, { huntId, hours: 1 }, tokenA);
    const longTrip = await post(`/api/characters/${b.id}/hunt`, { huntId, hours: 8 }, tokenB);
    expect(shortTrip.statusCode, shortTrip.body).toBe(200);
    expect(longTrip.statusCode, longTrip.body).toBe(200);
    expect(shortTrip.json().character.gold).toBeGreaterThan(longTrip.json().character.gold);
  });

  it('buys a temple blessing', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 50_000;
      state.blessings = 0;
    });
    const bought = await post(`/api/characters/${character.id}/act`, { type: 'blessing' }, token);
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().character.blessings).toBe(2);
    expect(bought.json().character.gold).toBeLessThan(50_000);
  });

  it('promotes a knight at the temple', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.level = 20;
      state.gold = 25_000;
      state.vocationId = 4;
    });
    const promoted = await post(`/api/characters/${character.id}/act`, { type: 'promotion' }, token);
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json().character.vocation.id).toBe(8);
    expect(promoted.json().character.promoted).toBe(true);
    expect(promoted.json().character.gold).toBe(5_000);

    const again = await post(`/api/characters/${character.id}/act`, { type: 'promotion' }, token);
    expect(again.statusCode).toBe(409);
  });

  it('publishes the daily boosted creature on the world snapshot', async () => {
    const { token } = await setup();
    const world = await get('/api/world', token);
    expect(world.statusCode, world.body).toBe(200);
    expect(world.json().boosted?.id).toBeTruthy();
    expect(world.json().boosted?.name).toBeTruthy();
  });

  it('assigns a hunting task', async () => {
    const { token, character } = await setup();
    const rolled = await post(`/api/characters/${character.id}/act`, { type: 'task-roll' }, token);
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect(rolled.json().character.task?.monsterId).toBeTruthy();
    expect(rolled.json().character.task?.required).toBeGreaterThan(0);
    expect(rolled.json().character.task?.claimed).toBe(false);
  });

  it('equips a warehouse item onto the paperdoll', async () => {
    const { token, character } = await setup();
    const wearable = items.find((item) =>
      item.type === 'armors'
      && item.armor >= 6
      && item.armor <= 12
      && (item.vocations.length === 0 || item.vocations.includes('knight'))
    );
    expect(wearable).toBeDefined();
    patchState(character.id, (state) => {
      state.warehouse = [{ itemId: wearable!.id, count: 1 }];
      state.level = 80;
    });
    const response = await post(`/api/characters/${character.id}/act`, { type: 'equip', itemId: wearable!.id, source: 'warehouse' }, token);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().character.equipment.armor?.id).toBe(wearable!.id);
  });

  it('equips loot pouch armor and replaces the worn piece', async () => {
    const { token, character } = await setup();
    const chain = items.find((item) => item.name === 'chain armor');
    const plate = items.find((item) => item.name === 'plate armor');
    expect(chain).toBeDefined();
    expect(plate).toBeDefined();
    patchState(character.id, (state) => {
      state.level = 80;
      state.gold = 50_000;
    });
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((hunt) => hunt.unlocked)!.id, hours: 1 }, token);
    expect(started.statusCode, started.body).toBe(200);
    const row = db.findCharacter(character.id)!;
    const session = JSON.parse(row.session!) as {
      character: { equipment: Record<string, number>; warehouse: Array<{ itemId: number; count: number }> };
      totals: { lootByItem: Record<number, number> };
    };
    session.character.equipment.armor = chain!.id;
    session.totals.lootByItem[plate!.id] = 1;
    db.saveCharacter(character.id, JSON.stringify(session.character), JSON.stringify(session), row.settledAt);

    const equipped = await post(`/api/characters/${character.id}/act`, {
      type: 'equip', itemId: plate!.id, source: 'pouch',
    }, token);
    expect(equipped.statusCode, equipped.body).toBe(200);
    const body = equipped.json().character as {
      equipment: Record<string, { id: number }>;
      warehouse: Array<{ itemId: number; count: number }>;
      session: { loot: Array<{ itemId: number; count: number }> } | null;
    };
    expect(body.equipment.armor?.id).toBe(plate!.id);
    const displaced = body.warehouse.some((stack) => stack.itemId === chain!.id)
      || (equipped.json().character.backpackContents ?? []).some((stack: { itemId: number }) => stack.itemId === chain!.id);
    expect(displaced).toBe(true);
    expect(body.session?.loot.some((stack) => stack.itemId === plate!.id)).toBeFalsy();
  });

  it('exalts worn gear and stores a boss helper profile', async () => {
    const { token, character } = await setup();
    const worn = (await get(`/api/characters/${character.id}`, token)).json().character as {
      equipment: Record<string, { id: number }>;
      forgeDust: number;
    };
    const slot = Object.keys(worn.equipment)[0];
    expect(slot).toBeTruthy();
    patchState(character.id, (state) => {
      state.gold = 5_000_000;
      state.level = 200;
      state.forgeDust = 2_000;
      state.forgeDustLevel = 225;
      state.equipmentTiers = { [slot!]: 0 };
    });

    let success = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      patchState(character.id, (state) => {
        state.forgeDust = Math.max(state.forgeDust ?? 0, 200);
        state.gold = Math.max(state.gold, 1_000_000);
      });
      const exalted = await post(`/api/characters/${character.id}/act`, { type: 'exalt', slot }, token);
      expect(exalted.statusCode, exalted.body).toBe(200);
      const body = exalted.json() as {
        success: boolean;
        tier: number;
        dustCost: number;
        character: { forgeDust: number };
      };
      expect(body.dustCost).toBe(100);
      if (body.success) {
        expect(body.tier).toBeGreaterThanOrEqual(1);
        success = true;
        break;
      }
    }
    expect(success).toBe(true);

    const policy = await post(`/api/characters/${character.id}/act`, {
      type: 'policy', helperMode: 'boss', taunt: true, healSpellAt: 0.9,
    }, token);
    expect(policy.statusCode, policy.body).toBe(200);
    expect(policy.json().character.helperProfiles.boss.taunt).toBe(true);
    expect(policy.json().character.policy.taunt).not.toBe(true);
  });

  it('runs forge convergence fusion and tier transfer', async () => {
    const { token, character } = await setup();
    const worn = (await get(`/api/characters/${character.id}`, token)).json().character as {
      equipment: Record<string, { id: number }>;
    };
    const slots = Object.keys(worn.equipment);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    const slot = slots[0]!;
    patchState(character.id, (state) => {
      state.gold = 200_000_000;
      state.level = 100;
      state.forgeDust = 500;
      state.forgeDustLevel = 225;
      state.forgeCores = 20;
      state.equipmentTiers = { [slot]: 0 };
      // Ensure a second wearable slot for transfer.
      if (slots.length < 2) {
        state.equipment.head = state.equipment.head
          ?? [...Object.values(state.equipment)][0];
      }
    });
    const fused = await post(`/api/characters/${character.id}/act`, {
      type: 'forge-convergence-fusion', slot,
    }, token);
    expect(fused.statusCode, fused.body).toBe(200);
    expect(fused.json().tier).toBe(1);
    expect(fused.json().dustCost).toBe(130);

    const after = (await get(`/api/characters/${character.id}`, token)).json().character as {
      equipment: Record<string, { id: number }>;
      equipmentTiers: Record<string, number>;
    };
    const donor = Object.keys(after.equipment).find((id) => (after.equipmentTiers[id] ?? 0) >= 1) ?? slot;
    const receive = Object.keys(after.equipment).find((id) => id !== donor);
    if (receive) {
      patchState(character.id, (state) => {
        state.equipmentTiers = { ...state.equipmentTiers, [donor]: 3, [receive]: 0 };
        state.forgeDust = 500;
        state.forgeCores = 20;
        state.gold = 200_000_000;
      });
      const moved = await post(`/api/characters/${character.id}/act`, {
        type: 'forge-transfer', donorSlot: donor, receiveSlot: receive, convergence: false,
      }, token);
      expect(moved.statusCode, moved.body).toBe(200);
      expect(moved.json().receiveTier).toBe(2);
      expect(moved.json().dustCost).toBe(100);
      expect(moved.json().character.equipmentTiers[receive]).toBe(2);
      expect(moved.json().character.equipmentTiers[donor]).toBe(0);
    }
  });

  it('lists cave-mates and shares party experience', async () => {
    const tokenA = (await post('/api/register', { username: 'partya', password: 'hunter2hunter2' })).json().token as string;
    const tokenB = (await post('/api/register', { username: 'partyb', password: 'hunter2hunter2' })).json().token as string;
    const a = (await post('/api/characters', { name: 'Partya', vocationId: 4 }, tokenA)).json().character as { id: number };
    const b = (await post('/api/characters', { name: 'Partyb', vocationId: 4 }, tokenB)).json().character as { id: number };
    patchState(a.id, (state) => { state.gold = 80_000; state.partySlots = 2; });
    patchState(b.id, (state) => { state.gold = 80_000; state.partySlots = 2; });
    const hunts = (await get(`/api/characters/${a.id}/hunts`, tokenA)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const huntId = hunts.find((hunt) => hunt.unlocked)!.id;
    expect((await post(`/api/characters/${a.id}/hunt`, { huntId, hours: 1 }, tokenA)).statusCode).toBe(200);
    expect((await post(`/api/characters/${b.id}/hunt`, { huntId, hours: 1 }, tokenB)).statusCode).toBe(200);
    markOnline(a.id);
    markOnline(b.id);
    const view = (await get(`/api/characters/${a.id}`, tokenA)).json().character as {
      partyBonus: number;
      caveParty: Array<{ name: string; self?: boolean }>;
    };
    expect(view.caveParty.some((mate) => mate.name === 'Partyb' && !mate.self)).toBe(true);
    expect(view.partyBonus).toBe(20);
  });

  it('drops offline hunters from the cave view and after leaving the hunt', async () => {
    const token = (await post('/api/register', { username: 'leaver', password: 'hunter2hunter2' })).json().token as string;
    const first = (await post('/api/characters', { name: 'Dev Ed', vocationId: 4 }, token)).json().character as { id: number };
    const second = (await post('/api/characters', { name: 'Alt Char', vocationId: 1 }, token)).json().character as { id: number };
    patchState(first.id, (state) => { state.gold = 80_000; });
    patchState(second.id, (state) => { state.gold = 80_000; });
    const hunts = (await get(`/api/characters/${first.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const huntId = hunts.find((hunt) => hunt.unlocked)!.id;
    expect((await post(`/api/characters/${first.id}/hunt`, { huntId, hours: 1 }, token)).statusCode).toBe(200);

    markOnline(first.id);
    markOnline(second.id);
    expect((await post(`/api/characters/${second.id}/hunt`, { huntId, hours: 1 }, token)).statusCode).toBe(200);
    const together = (await get(`/api/characters/${second.id}`, token)).json().character as {
      caveParty: Array<{ name: string; self?: boolean }>;
    };
    expect(together.caveParty.some((mate) => mate.name === 'Dev Ed')).toBe(true);

    expect((await del(`/api/characters/${first.id}/hunt`, token)).statusCode).toBe(200);
    const afterLeave = (await get(`/api/characters/${second.id}`, token)).json().character as {
      caveParty: Array<{ name: string; self?: boolean }>;
    };
    expect(afterLeave.caveParty.some((mate) => mate.name === 'Dev Ed')).toBe(false);
  });

  it('consumes shrine reagents to imbue', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 80_000;
      state.equipment.left = 3271; // spike sword — 2 imbue slots
      state.warehouse = [{ itemId: 11444, count: 20 }];
    });
    const missing = await post(`/api/characters/${character.id}/act`, { type: 'imbue', slot: 'left', imbue: 'strike', tier: 2 }, token);
    expect(missing.statusCode).toBe(402);
    const imbued = await post(`/api/characters/${character.id}/act`, { type: 'imbue', slot: 'left', imbue: 'strike', tier: 1 }, token);
    expect(imbued.statusCode, imbued.body).toBe(200);
    expect(imbued.json().character.imbuements[0].type).toBe('strike');
    expect(imbued.json().character.warehouse.some((stack: { itemId: number }) => stack.itemId === 11444)).toBe(false);
  });

  it('lets a guild leader kick and a member leave', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => { state.gold = 80_000; });
    const created = await post(`/api/characters/${character.id}/act`, { type: 'guild-create', name: 'Kickers' }, token);
    expect(created.statusCode, created.body).toBe(200);

    const otherToken = (await post('/api/register', { username: 'guildie', password: 'hunter2hunter2' })).json().token as string;
    const other = (await post('/api/characters', { name: 'Guildie', vocationId: 4 }, otherToken)).json().character as { id: number; guildId: number | null };
    const guildId = created.json().character.guildId as number;
    const joined = await post(`/api/characters/${other.id}/act`, { type: 'guild-join', guildId }, otherToken);
    expect(joined.statusCode, joined.body).toBe(200);

    const kicked = await post(`/api/characters/${character.id}/act`, { type: 'guild-kick', characterId: other.id }, token);
    expect(kicked.statusCode, kicked.body).toBe(200);
    const afterKick = (await get(`/api/characters/${other.id}`, otherToken)).json().character as { guildId: number | null };
    expect(afterKick.guildId).toBeNull();

    const rejoin = await post(`/api/characters/${other.id}/act`, { type: 'guild-join', guildId }, otherToken);
    expect(rejoin.statusCode, rejoin.body).toBe(200);
    const left = await post(`/api/characters/${other.id}/act`, { type: 'guild-leave' }, otherToken);
    expect(left.statusCode, left.body).toBe(200);
    expect(left.json().character.guildId).toBeNull();
  });

  it('sends jewellery from the merchant to the backpack', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 50_000;
      const equipment = state.equipment as Record<string, number>;
      equipment.ring = 3052;
    });
    const bought = await post(`/api/characters/${character.id}/act`, { type: 'npc-buy', itemId: 3052, count: 1 }, token);
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().character.backpackContents.some((stack: { itemId: number }) => stack.itemId === 3052)).toBe(true);
  });

  it('auto-equips a bought backpack and stores potions in supplies', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 50_000;
      const equipment = state.equipment as Record<string, number>;
      delete equipment.backpack;
    });

    const backpack = await post(`/api/characters/${character.id}/act`, { type: 'npc-buy', itemId: 2854, count: 1 }, token);
    expect(backpack.statusCode, backpack.body).toBe(200);
    expect(backpack.json().character.equipment.backpack?.id).toBe(2854);
    expect(backpack.json().character.supplies.some((stack: { itemId: number }) => stack.itemId === 2854)).toBe(false);

    const potion = await post(`/api/characters/${character.id}/act`, { type: 'npc-buy', itemId: 266, count: 3 }, token);
    expect(potion.statusCode, potion.body).toBe(200);
    expect(potion.json().character.supplies.find((stack: { itemId: number; count: number }) => stack.itemId === 266)?.count).toBe(3);
  });

  it('auto-equips a backpack stored in the supply pouch on load', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.supplies = [{ itemId: 2871, count: 1 }];
      const equipment = state.equipment as Record<string, number>;
      delete equipment.backpack;
    });

    const loaded = await get(`/api/characters/${character.id}`, token);
    expect(loaded.statusCode, loaded.body).toBe(200);
    expect(loaded.json().character.equipment.backpack?.id).toBe(2871);
    expect(loaded.json().character.supplies.some((stack: { itemId: number }) => stack.itemId === 2871)).toBe(false);
  });

  it('equips a backpack from the supply pouch when another is worn', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.supplies = [{ itemId: 2871, count: 1 }];
      const equipment = state.equipment as Record<string, number>;
      equipment.backpack = 2854;
    });

    const equipped = await post(`/api/characters/${character.id}/act`, { type: 'equip', itemId: 2871, source: 'supply' }, token);
    expect(equipped.statusCode, equipped.body).toBe(200);
    expect(equipped.json().character.equipment.backpack?.id).toBe(2871);
    expect(equipped.json().character.supplies.some((stack: { itemId: number }) => stack.itemId === 2871)).toBe(false);
    const storedOld = equipped.json().character.warehouse.some((stack: { itemId: number }) => stack.itemId === 2854)
      || equipped.json().character.backpackContents?.some((stack: { itemId: number }) => stack.itemId === 2854);
    expect(storedOld).toBe(true);
  });

  it('moves supply stacks into the worn backpack', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.supplies = [{ itemId: 3031, count: 10 }];
      state.backpackContents = [];
    });

    const moved = await post(`/api/characters/${character.id}/act`, {
      type: 'move-item',
      itemId: 3031,
      source: 'supply',
      count: 5,
    }, token);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().character.backpackContents.find((stack: { itemId: number; count: number }) => stack.itemId === 3031)?.count).toBe(5);
    expect(moved.json().character.supplies.find((stack: { itemId: number; count: number }) => stack.itemId === 3031)?.count).toBe(5);
  });

  it('restocks hunt supplies from the warehouse first', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 5_000;
      state.warehouse = [{ itemId: 266, count: 5_000 }];
    });
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((hunt) => hunt.unlocked)!.id, hours: 1 }, token);
    expect(started.statusCode, started.body).toBe(200);
    const gold = started.json().character.gold as number;
    expect(gold).toBeGreaterThan(2_500);
    const left = started.json().character.warehouse.find((stack: { itemId: number; count: number }) => stack.itemId === 266) as { count: number } | undefined;
    expect(left === undefined || left.count < 5_000).toBe(true);
  });

  it('refills health and mana at the temple after a cave death', () => {
    const character = createCharacter('Kina', 4);
    const session = startSession(character, 'venore-rotworm-cave', 1n);
    session.status = 'died';
    session.character.health = 0;
    session.character.mana = 0;
    const result = endHunt(session);
    const stats = deriveStats(result.character);
    expect(result.character.health).toBe(stats.maxHealth);
    expect(result.character.mana).toBe(stats.maxMana);
  });

  it('uses a mana potion from supplies', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.supplies = [{ itemId: 268, count: 5 }];
      state.mana = 10;
    });
    const before = (await get(`/api/characters/${character.id}`, token)).json().character as {
      mana: number;
      supplies: Array<{ itemId: number; count: number }>;
    };
    const used = await post(`/api/characters/${character.id}/act`, { type: 'use-item', itemId: 268, source: 'supply' }, token);
    expect(used.statusCode, used.body).toBe(200);
    const payload = used.json();
    expect(payload.mana).toBeGreaterThan(0);
    expect(payload.character.mana).toBeGreaterThan(before.mana);
    expect(payload.character.supplies.find((stack: { itemId: number }) => stack.itemId === 268)?.count).toBe(4);
  });

  it('uses a mana potion while hunting', async () => {
    const { token, character } = await setup();
    patchState(character.id, (state) => {
      state.gold = 50_000;
      state.level = 20;
    });
    const hunts = (await get(`/api/characters/${character.id}/hunts`, token)).json().hunts as Array<{ id: string; unlocked: boolean }>;
    const started = await post(`/api/characters/${character.id}/hunt`, { huntId: hunts.find((hunt) => hunt.unlocked)!.id, hours: 1 }, token);
    expect(started.statusCode, started.body).toBe(200);
    const row = db.findCharacter(character.id)!;
    const session = JSON.parse(row.session!) as { character: { mana: number; supplies: Array<{ itemId: number; count: number }> } };
    session.character.mana = 5;
    const manaStack = session.character.supplies.find((stack) => stack.itemId === 268 || stack.itemId === 237);
    expect(manaStack).toBeDefined();
    const beforeCount = manaStack!.count;
    db.saveCharacter(character.id, row.state, JSON.stringify(session), row.settledAt);
    const used = await post(`/api/characters/${character.id}/act`, { type: 'use-item', itemId: manaStack!.itemId, source: 'supply' }, token);
    expect(used.statusCode, used.body).toBe(200);
    const after = used.json().character as { mana: number; supplies: Array<{ itemId: number; count: number }> };
    expect(after.mana).toBeGreaterThan(5);
    expect(after.supplies.find((stack) => stack.itemId === manaStack!.itemId)?.count).toBe(beforeCount - 1);
  });
});
