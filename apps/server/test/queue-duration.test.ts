import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacter, type CharacterState, type HuntSession } from '@tibia-idle/sim';
import { Database } from '../src/db.js';
import { beginHunt } from '../src/settle.js';
import { promoteHunt, setHuntCap, tryStartOrQueue } from '../src/queue.js';

const HUNT = 'venore-rotworm-cave';
const NOW = Date.UTC(2026, 8, 10, 12);

let db: Database;
let accountId: number;

beforeEach(() => {
  db = new Database(':memory:');
  accountId = db.createAccount('queue-test', 'hash', 'salt').id;
  setHuntCap(1);
});

afterEach(() => {
  setHuntCap(8);
  db.close();
});

function makeCharacter(name: string) {
  const state = createCharacter(name, 4);
  state.level = 800;
  state.gold = 10_000_000;
  const row = db.createCharacter(accountId, name, 4, JSON.stringify(state));
  db.saveCharacter(row.id, JSON.stringify(state), null, NOW);
  return { row, state };
}

function supplyCount(character: CharacterState): number {
  return character.supplies.reduce((sum, stack) => sum + stack.count, 0);
}

describe('hunt queue duration', () => {
  it('keeps the selected duration when a queued character is promoted', () => {
    const blocker = makeCharacter('Blocker');
    const queued = makeCharacter('Queued Hunter');

    expect(tryStartOrQueue(db, { row: blocker.row, character: blocker.state, session: null }, HUNT, NOW, 1)).toBe('started');
    expect(tryStartOrQueue(db, { row: queued.row, character: queued.state, session: null }, HUNT, NOW, 8)).toBe('queued');
    expect(db.getWorld(`hunt-queue-hours:${queued.row.id}`)).toBe('8');

    const expectedCharacter = createCharacter('Expected Hunter', 4);
    expectedCharacter.level = 800;
    expectedCharacter.gold = 10_000_000;
    const expected = beginHunt(expectedCharacter, HUNT, 1n, { hours: 8 });

    db.releaseHunt(blocker.row.id);
    promoteHunt(db, HUNT, NOW + 1);

    const promotedRow = db.findCharacter(queued.row.id)!;
    const promoted = JSON.parse(promotedRow.session!) as HuntSession;
    expect(supplyCount(promoted.character)).toBe(supplyCount(expected.character));
    expect(db.getWorld(`hunt-queue-hours:${queued.row.id}`)).toBe('');
  });
});
