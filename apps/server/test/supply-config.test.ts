import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { issueToken } from '../src/auth.js';
import { createCharacter } from '@tibia-idle/sim';
import { itemsById } from '@tibia-idle/data';
import { sweepIgnoredLoot } from '../src/party-items.js';

it('persists supply choices, validates items and retains overflow instead of auto-selling', async () => {
  const { app, db } = await createApp({ databaseFile: ':memory:' });
  try {
    const account = db.createAccount('supply-test', 'hash', 'salt');
    const { token } = issueToken(db, account.id, account.username);
    const state = createCharacter('Supply Tester', 4);
    const row = db.createCharacter(account.id, state.name, 4, JSON.stringify(state));
    const headers = { authorization: `Bearer ${token}` };
    const url = `/api/characters/${row.id}/loot-preferences`;
    const save = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers, payload });
    expect((await save({ itemId: 3447, ignored: true })).statusCode).toBe(200);
    const saved = await save({ itemId: 3447, container: 'supply' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().ignoredItemIds).not.toContain(3447);
    expect((await app.inject({ method: 'GET', url, headers })).json().containers['3447']).toBe('supply');
    expect((await save({ itemId: 3031, container: 'supply' })).statusCode).toBe(400);
    for (const name of ['amber bow', 'amber crossbow', 'ancient crypt rune', 'animate dead rune', 'bolt', 'great spirit potion']) {
      const item = [...itemsById.values()].find((entry) => entry.name.toLowerCase() === name)!;
      expect(item, name).toBeDefined();
      expect((await save({ itemId: item.id, container: 'supply' })).statusCode, name).toBe(400);
    }
    for (const itemId of [266, 268, 15793]) {
      expect((await save({ itemId, container: 'supply' })).statusCode).toBe(200);
    }
    const stored = JSON.parse(db.findCharacter(row.id)!.state);
    stored.lootAutoSell = true;
    stored.supplySlots = 1;
    stored.supplies = [{ itemId: 266, count: 1 }];
    const session = { character: structuredClone(stored), totals: { lootByItem: { 3447: 10 } } };
    db.saveCharacter(row.id, JSON.stringify(stored), JSON.stringify(session), Date.now());
    sweepIgnoredLoot(db);
    expect(JSON.parse(db.findCharacter(row.id)!.session!).totals.lootByItem['3447']).toBe(10);
    session.character.supplies = [];
    db.saveCharacter(row.id, JSON.stringify(stored), JSON.stringify(session), Date.now());
    sweepIgnoredLoot(db);
    const routed = JSON.parse(db.findCharacter(row.id)!.session!);
    expect(routed.character.supplies).toContainEqual({ itemId: 3447, count: 10 });
    expect(routed.totals.lootByItem['3447']).toBeUndefined();
    db.saveCharacter(row.id, JSON.stringify(stored), null, Date.now());
    expect((await save({ itemId: 3447, container: 'pouch' })).json().containers['3447']).toBeUndefined();
  } finally { await app.close(); }
});
