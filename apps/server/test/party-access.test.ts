import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacter } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { partyPrincipal } from '../src/party-access.js';

let db: Database;
let accountId: number;

beforeEach(() => {
  db = new Database(':memory:');
  accountId = db.createAccount('party-access-test', 'hash', 'salt').id;
});

afterEach(() => db.close());

function make(name: string, level: number) {
  const state = createCharacter(name, 4);
  state.level = level;
  const row = db.createCharacter(accountId, name, 4, JSON.stringify(state));
  return { row, state };
}

describe('party principal resolution', () => {
  it('prefers a character own canonical party over a stale overlapping formation', () => {
    const staleOwner = make('Stale Owner', 50);
    const principal = make('Real Principal', 115);
    const companion = make('Companion', 800);

    db.setWorld(`party:${staleOwner.row.id}`, JSON.stringify([staleOwner.row.id, principal.row.id]));
    db.setWorld(`party:${principal.row.id}`, JSON.stringify([principal.row.id, companion.row.id]));

    expect(partyPrincipal(db, principal.row).level).toBe(115);
    expect(partyPrincipal(db, companion.row).level).toBe(115);
  });
});
