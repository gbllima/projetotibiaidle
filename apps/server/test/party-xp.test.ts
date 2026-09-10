import { describe, expect, it } from 'vitest';
import { createCharacter, deriveStats, expForLevel, SPELLS, startSession, waveProgress } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { loadCharacter, reconcileHunts } from '../src/game.js';
import { settleParty } from '../src/party-settlement.js';

const START = 1_700_000_000_000;
function member(id: number, attacks = true) {
  const character = createCharacter('Party ' + id, 4);
  character.level = 40;
  character.experience = expForLevel(40);
  character.skills.sword = { level: 70, tries: 0 };
  character.equipment.left = 3271;
  character.health = deriveStats(character).maxHealth;
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  character.policy.disabledSpells = SPELLS.map((spell) => spell.id);
  const session = startSession(character, 'venore-rotworm-cave', id);
  session.startedAt = START;
  if (!attacks) session.playerAttackCooldown = 100_000;
  return { id, session, settledAt: START };
}

describe('party XP', () => {
  it('awards nothing until a member kills a monster', () => {
    const members = [member(1, false), member(2, false), member(3, false)];
    const result = settleParty(members, START + 5_000);
    expect(result.entries.every((entry) => entry.result.delta.kills === 0)).toBe(true);
    expect(result.entries.every((entry) => entry.result.delta.experience === 0)).toBe(true);
  });

  it('shares one attacker’s kills equally among three active members', () => {
    const members = [member(1), member(2, false), member(3, false)];
    const result = settleParty(members, START + 20_000);
    const xp = result.entries.map((entry) => entry.result.delta.experience);
    expect(result.entries[0]!.result.delta.kills).toBeGreaterThan(0);
    expect(result.entries[1]!.result.delta.kills).toBe(0);
    expect(Math.min(...xp)).toBeGreaterThan(0);
    expect(Math.max(...xp) - Math.min(...xp)).toBeLessThanOrEqual(1);
    for (const entry of result.entries) {
      expect(entry.session.character.experience - expForLevel(40)).toBe(entry.result.delta.experience);
    }
  });

  it('excludes inactive members and members in another hunt', () => {
    const members = [member(1), member(2, false), member(3, false)];
    members[1]!.session.status = 'stopped';
    members[2]!.session.huntId = 'kha-labal-terramites-cave';
    const result = settleParty(members, START + 20_000);
    expect(result.entries[0]!.result.delta.experience).toBeGreaterThan(0);
    expect(result.entries[1]!.result.delta.experience).toBe(0);
    expect(result.entries[2]!.result.delta.experience).toBe(0);
  });

  it('stops crediting a member after it leaves, and preserves XP on rounding', () => {
    const members = [member(1), member(2, false), member(3, false)];
    const first = settleParty(members, START + 10_000);
    const before = members[2]!.session.character.experience;
    members[2]!.session.status = 'stopped';
    // Make the next wave available so the test isolates eligibility after leaving.
    members[0]!.session.spawnCredits = waveProgress(members[0]!.session.totals.kills).size;
    const next = first.entries.map((entry) => ({ id: entry.id, session: entry.session, settledAt: entry.cursor }));
    const second = settleParty(next, START + 20_000, first.remainderCursor);
    expect(members[2]!.session.character.experience).toBe(before);
    expect(second.entries[0]!.result.delta.kills).toBeGreaterThan(0);
    expect(second.entries[0]!.result.delta.experience).toBeGreaterThan(0);
    expect(Math.abs(second.entries[0]!.result.delta.experience - second.entries[1]!.result.delta.experience)).toBeLessThanOrEqual(1);
  });

  it('settles the entire party when reading a member and never duplicates XP', () => {
    const db = new Database(':memory:');
    try {
      const account = db.createAccount('party-test', 'hash', 'salt');
      const ids = [1, 2, 3].map((id) => {
        const { session } = member(id, id === 1);
        const row = db.createCharacter(account.id, session.character.name, 4, JSON.stringify(session.character));
        db.saveCharacter(row.id, JSON.stringify(session.character), JSON.stringify(session), START);
        return row.id;
      });
      db.setWorld('party:' + ids[0], JSON.stringify(ids));
      loadCharacter(db, account.id, ids[1]!, START + 20_000);
      const experiences = () => ids.map((id) => JSON.parse(db.findCharacter(id)!.session!).character.experience as number);
      const before = experiences();
      expect(Math.min(...before)).toBeGreaterThan(expForLevel(40));
      expect(Math.max(...before) - Math.min(...before)).toBeLessThanOrEqual(1);
      loadCharacter(db, account.id, ids[0]!, START + 20_000);
      reconcileHunts(db, START + 20_000);
      expect(experiences()).toEqual(before);
    } finally { db.close(); }
  });
});
