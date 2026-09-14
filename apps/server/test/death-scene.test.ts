import { expect, it } from 'vitest';
import { createCharacter, startSession } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { describeCharacter, loadCharacter } from '../src/game.js';
import { writeFileSync } from 'node:fs';

it('retains a death marker after settlement restores HP, and clears it on a new hunt', () => {
  const db = new Database(':memory:');
  try {
    const account = db.createAccount('corpse-test', 'hash', 'salt');
    const character = createCharacter('Fallen', 4);
    const row = db.createCharacter(account.id, character.name, 4, JSON.stringify(character));
    const session = startSession(character, 'venore-rotworm-cave', 1);
    session.status = 'died'; session.character.health = 0;
    const now = Date.now();
    db.saveCharacter(row.id, JSON.stringify(character), JSON.stringify(session), now);
    const { loaded } = loadCharacter(db, account.id, row.id, now);
    expect(loaded.session).toBeNull();
    expect(loaded.character.health).toBeGreaterThan(0);
    expect(describeCharacter(loaded, db).deathScene).toEqual({ huntId: session.huntId, at: now });
    const next = startSession(loaded.character, session.huntId, 2);
    db.saveCharacter(row.id, JSON.stringify(loaded.character), JSON.stringify(next), now);
    loadCharacter(db, account.id, row.id, now);
    expect(db.getWorld(`death-scene:${row.id}`)).toBe('');
  } finally { db.close(); }
});

it('keeps the fight visible after the principal dies until the last companion dies', () => {
  const db = new Database(':memory:');
  try {
    const account = db.createAccount('party-death-test', 'hash', 'salt');
    const now = Date.now();
    const rows = ['Principal', 'Companion'].map((name, index) => {
      const character = createCharacter(name, 4);
      const row = db.createCharacter(account.id, name, 4, JSON.stringify(character));
      const session = startSession(character, 'venore-rotworm-cave', index + 1);
      session.startedAt = now - 1000;
      if (index === 0) { session.status = 'died'; character.health = 0; }
      db.saveCharacter(row.id, JSON.stringify(character), JSON.stringify(session), now);
      return row;
    });
    db.setWorld(`party:${rows[0]!.id}`, JSON.stringify(rows.map((row) => row.id)));
    const principal = loadCharacter(db, account.id, rows[0]!.id, now).loaded;
    const fighting = describeCharacter(principal, db);
    expect(fighting.session).toBeNull();
    expect(fighting.partyActivity?.memberIds).toEqual([rows[1]!.id]);
    expect(fighting.caveParty.find((member) => member.self)).toMatchObject({ active: false, diedInHunt: true });
    const companion = db.findCharacter(rows[1]!.id)!;
    const session = JSON.parse(companion.session!);
    session.status = 'died'; session.character.health = 0;
    db.saveCharacter(companion.id, companion.state, JSON.stringify(session), now);
    loadCharacter(db, account.id, companion.id, now);
    const finished = describeCharacter(loadCharacter(db, account.id, rows[0]!.id, now).loaded, db);
    expect(finished.partyActivity).toBeNull();
    expect(finished.session).toBeNull();
    // Optional browser fixture: synthetic characters only, never live account data.
    if (process.env['DEATH_SCENE_FIXTURE']) writeFileSync(process.env['DEATH_SCENE_FIXTURE'], JSON.stringify({ fighting, finished }));
  } finally { db.close(); }
});
