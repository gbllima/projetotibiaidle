import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hunts, recommendedLevelFor } from '@tibia-idle/data';
import { createCharacter, type CharacterState } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { adminAct, adminSnapshot } from '../src/admin.js';
import { accountFromHeader, issueToken, isAdminUsername } from '../src/auth.js';
import { configureParty, listHunts, loadCharacter, startHunt } from '../src/game.js';
import { beginHunt, regenStamina } from '../src/settle.js';

let db: Database;
let ownerId: number;
const NOW = Date.UTC(2026, 8, 10, 12);
beforeEach(() => { db = new Database(':memory:'); ownerId = db.createAccount('player', 'hash', 'salt').id; });
afterEach(() => db.close());
function create(name: string, level = 51, accountId = ownerId) {
  const state = createCharacter(name, 4); state.level = level; state.partySlots = 3; state.gold = 500_000;
  const row = db.createCharacter(accountId, name, 4, JSON.stringify(state));
  db.saveCharacter(row.id, JSON.stringify(state), null, NOW);
  return { row, state };
}

describe('party formation', () => {
  it('saves leadership and formation together and transfers the shared backpack', () => {
    const a = create('Principal'), b = create('Companion');
    a.state.backpackContents = [{ itemId: 3271, count: 2 }];
    db.saveCharacter(a.row.id, JSON.stringify(a.state), null, NOW);
    db.setWorld('party:' + a.row.id, JSON.stringify([a.row.id, b.row.id]));
    expect(configureParty(db, ownerId, a.row.id, [a.row.id, b.row.id], b.row.id, NOW)).toBe(b.row.id);
    expect(JSON.parse(db.getWorld('party:' + b.row.id)!)).toEqual([b.row.id, a.row.id]);
    expect(loadCharacter(db, ownerId, b.row.id, NOW).loaded.character.backpackContents).toEqual([{ itemId: 3271, count: 2 }]);
    expect(loadCharacter(db, ownerId, a.row.id, NOW).loaded.character.backpackContents).toEqual([]);
  });
  it('rejects cross-account members, duplicates and full formations without changes', () => {
    const a = create('Principal'); a.state.partySlots = 1; db.saveCharacter(a.row.id, JSON.stringify(a.state), null, NOW);
    const b = create('Companion');
    expect(() => configureParty(db, ownerId, a.row.id, [a.row.id, b.row.id], a.row.id, NOW)).toThrow();
    expect(() => configureParty(db, ownerId, a.row.id, [a.row.id, a.row.id], a.row.id, NOW)).toThrow();
    const outsider = create('Outsider', 51, db.createAccount('outsider', 'hash', 'salt').id);
    expect(() => configureParty(db, ownerId, a.row.id, [outsider.row.id], outsider.row.id, NOW)).toThrow();
    expect(db.getWorld('party:' + a.row.id)).toBeNull();
  });
});

describe('gradual content access', () => {
  it('uses the exact vocation requirement and the party principal', () => {
    const hunt = hunts.find((entry) => {
      const required = recommendedLevelFor(entry.id, 4);
      return required !== null && required > 51 && entry.partySizes.includes('solo');
    })!;
    const required = recommendedLevelFor(hunt.id, 4)!;
    const principal = create('Principal', required - 1), companion = create('Companion', 800);
    db.setWorld('party:' + principal.row.id, JSON.stringify([principal.row.id, companion.row.id]));
    expect(listHunts(principal.state).find((entry) => entry.id === hunt.id)?.recommendedLevel).toBe(required);
    expect(listHunts(principal.state).find((entry) => entry.id === hunt.id)?.unlocked).toBe(false);
    expect(() => startHunt(db, ownerId, companion.row.id, hunt.id, NOW)).toThrow();
    principal.state.level = required;
    expect(listHunts(principal.state).find((entry) => entry.id === hunt.id)?.unlocked).toBe(true);
    expect(() => beginHunt(companion.state, hunt.id, 1n, { restock: false, principal: principal.state })).not.toThrow();
  });

  it('blocks Hive Surface for a level 88 Knight principal until level 115', () => {
    const principal = create('Principal', 88);
    const companion = create('Companion', 800);
    db.setWorld('party:' + principal.row.id, JSON.stringify([principal.row.id, companion.row.id]));
    expect(recommendedLevelFor('hive-surface', principal.state.vocationId)).toBe(115);
    expect(listHunts(principal.state).find((entry) => entry.id === 'hive-surface')?.unlocked).toBe(false);
    expect(() => startHunt(db, ownerId, principal.row.id, 'hive-surface', NOW)).toThrow();
    expect(() => startHunt(db, ownerId, companion.row.id, 'hive-surface', NOW)).toThrow();
    expect(() => beginHunt(companion.state, 'hive-surface', 1n, { restock: false, principal: principal.state })).toThrow('nível 115');
    principal.state.level = 115;
    expect(listHunts(principal.state).find((entry) => entry.id === 'hive-surface')?.unlocked).toBe(true);
    expect(() => beginHunt(companion.state, 'hive-surface', 1n, { restock: false, principal: principal.state })).not.toThrow();
  });

  it('keeps starting content available to a new level 8 character', () => {
    const newbie = createCharacter('Newbie', 4);
    expect(listHunts(newbie).some((entry) => entry.unlocked && !entry.partyLocked)).toBe(true);
  });
});

describe('stamina in the city', () => {
  it('preserves partial rest through repeated server polls', () => {
    const { row, state } = create('Resting'); state.stamina = 2000;
    db.saveCharacter(row.id, JSON.stringify(state), null, NOW);
    for (let seconds = 2; seconds <= 780; seconds += 2) loadCharacter(db, ownerId, row.id, NOW + seconds * 1000);
    const rested = loadCharacter(db, ownerId, row.id, NOW + 780_000).loaded.character;
    expect(rested.stamina).toBe(2001);
  });
  it('respects both rates, the cap and a new hunting interruption', () => {
    const state = createCharacter('Resting', 4); state.stamina = 2339;
    regenStamina(state, 19 * 60_000);
    expect(state.stamina).toBe(2341);
    regenStamina(state, 200 * 60 * 60_000);
    expect(state.stamina).toBe(2520);
    beginHunt(state, 'venore-rotworm-cave', 1n, { restock: false });
    expect(state.staminaRestMs).toBe(0);
    expect(state.staminaRegenCreditMs).toBe(0);
  });
});

describe('character persistence', () => {
  it('keeps the indexed character name synchronized after a rename', () => {
    const player = create('Old Name');
    player.state.name = 'New Name';
    db.saveCharacter(player.row.id, JSON.stringify(player.state), null, NOW);
    expect(db.findCharacterByName('Old Name')).toBeNull();
    expect(db.findCharacterByName('New Name')?.id).toBe(player.row.id);
  });
});

describe('account administration', () => {
  it('grants gbllima access and rejects regular or generic admin accounts', () => {
    expect(isAdminUsername('gbllima')).toBe(true);
    expect(isAdminUsername('admin')).toBe(false);
    expect(() => adminAct(db, ownerId, { type: 'set-gold', characterId: 1, gold: 500 })).toThrow('Admin only');
  });
  it('edits character gold and depot items and creates characters for a chosen account', () => {
    const admin = db.createAccount('gbllima', 'hash', 'salt');
    const player = create('Player');
    adminAct(db, admin.id, { type: 'set-gold', characterId: player.row.id, gold: 123456 }, NOW);
    adminAct(db, admin.id, { type: 'set-item', characterId: player.row.id, itemId: 3271, count: 2 }, NOW);
    const saved = JSON.parse(db.findCharacter(player.row.id)!.state) as CharacterState;
    expect(saved.gold).toBe(123456);
    expect(saved.warehouse.find((entry) => entry.itemId === 3271)?.count).toBe(2);
    expect(() => adminAct(db, admin.id, { type: 'set-gold', characterId: player.row.id, gold: -1 }, NOW)).toThrow();
    expect(() => adminAct(db, admin.id, { type: 'set-item', characterId: player.row.id, itemId: -1, count: 2 }, NOW)).toThrow();
    adminAct(db, admin.id, { type: 'create-character', accountId: ownerId, name: 'New Hunter', vocationId: 3 }, NOW);
    expect(db.findCharacterByName('New Hunter')?.accountId).toBe(ownerId);
  });
  it('bans access, revokes sessions and can unban without locking out the administrator', () => {
    const admin = db.createAccount('gbllima', 'hash', 'salt');
    const player = create('Player');
    const token = issueToken(db, ownerId, 'player').token;
    expect(accountFromHeader(db, 'Bearer ' + token)).toBe(ownerId);
    adminAct(db, admin.id, { type: 'ban', accountId: ownerId, reason: 'Test' }, NOW);
    expect(accountFromHeader(db, 'Bearer ' + token)).toBeNull();
    expect(() => loadCharacter(db, ownerId, player.row.id, NOW)).toThrow('Conta banida');
    expect(adminSnapshot(db).accounts.find((entry) => entry.id === ownerId)?.banned).toBe(true);
    expect(() => adminAct(db, admin.id, { type: 'ban', accountId: admin.id }, NOW)).toThrow();
    adminAct(db, admin.id, { type: 'unban', accountId: ownerId }, NOW);
    expect(() => loadCharacter(db, ownerId, player.row.id, NOW)).not.toThrow();
  });
});
