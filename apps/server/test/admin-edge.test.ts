import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacter, startSession, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { adminAct } from '../src/admin.js';

const NOW = Date.UTC(2026, 8, 10, 22, 0, 0);
let db: Database;
let adminId: number;
let playerId: number;

beforeEach(() => {
  db = new Database(':memory:');
  adminId = db.createAccount('gbllima', 'hash', 'salt').id;
  playerId = db.createAccount('player', 'hash', 'salt').id;
});

afterEach(() => db.close());

function createActiveHunter(): number {
  const character = createCharacter('Hunter', 4);
  character.gold = 500_000;
  character.coins = 0;
  const row = db.createCharacter(playerId, character.name, character.vocationId, JSON.stringify(character));
  const session = startSession(character, 'venore-rotworm-cave', 1n);
  session.startedAt = NOW;
  db.saveCharacter(row.id, JSON.stringify(character), JSON.stringify(session), NOW);
  return row.id;
}

describe('admin edge cases', () => {
  it('fulfills Tibia Coins into the authoritative active hunt character', () => {
    const characterId = createActiveHunter();
    const orderId = db.createCoinOrder(playerId, 'pack50', 50, 4.99);

    expect(adminAct(db, adminId, { type: 'fulfill', orderId }, NOW)).toMatchObject({ ok: true, coins: 50 });

    const row = db.findCharacter(characterId)!;
    const session = JSON.parse(row.session!) as HuntSession;
    const state = JSON.parse(row.state) as CharacterState;
    expect(session.character.coins).toBe(50);
    expect(state.coins).toBe(50);
    expect(String(db.findCoinOrder(orderId)?.['status'])).toBe('paid');
  });

  it('does not mark an order paid when the account has no character to receive it', () => {
    const emptyAccount = db.createAccount('empty', 'hash', 'salt').id;
    const orderId = db.createCoinOrder(emptyAccount, 'pack50', 50, 4.99);

    expect(() => adminAct(db, adminId, { type: 'fulfill', orderId }, NOW)).toThrow();
    expect(String(db.findCoinOrder(orderId)?.['status'])).toBe('pending');
  });

  it('grants VIP to the whole account, including active hunt sessions', () => {
    const firstId = createActiveHunter();
    const second = createCharacter('Altvip', 1);
    const secondRow = db.createCharacter(playerId, second.name, second.vocationId, JSON.stringify(second));

    adminAct(db, adminId, { type: 'grant', characterId: firstId, vipDays: 7 }, NOW);

    const expectedUntil = NOW + 7 * 86_400_000;
    const firstRow = db.findCharacter(firstId)!;
    const firstSession = JSON.parse(firstRow.session!) as HuntSession;
    const secondState = JSON.parse(db.findCharacter(secondRow.id)!.state) as CharacterState;
    expect(firstSession.character.premium).toBe(true);
    expect(firstSession.character.vipUntil).toBe(expectedUntil);
    expect(secondState.premium).toBe(true);
    expect(secondState.vipUntil).toBe(expectedUntil);
    expect(Number(db.getWorld(`vip:${playerId}`))).toBe(expectedUntil);
  });

  it('rejects non-finite or excessive numeric admin mutations', () => {
    const characterId = createActiveHunter();
    expect(() => adminAct(db, adminId, { type: 'grant', characterId, gold: Infinity }, NOW)).toThrow('Valor numérico inválido');
    expect(() => adminAct(db, adminId, { type: 'code', code: 'BAD-NUM', coins: Infinity }, NOW)).toThrow('Valor numérico inválido');
    expect(() => adminAct(db, adminId, { type: 'mute', accountId: playerId, minutes: 999_999_999 }, NOW)).toThrow('Valor numérico inválido');
  });
});