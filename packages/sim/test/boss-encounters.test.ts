import { describe, expect, it } from 'vitest';
import { createCharacter, startSession, parseBossHuntId, bossHuntId, bossOnCooldown, recordBossKill, BOSS_COOLDOWN_MS, getBossEncounter } from '../src/index.js';

describe('boss encounters', () => {
  it('parses boss hunt ids', () => {
    expect(parseBossHuntId('boss:ferumbras')).toBe('ferumbras');
    expect(parseBossHuntId('rats')).toBeNull();
  });

  it('starts with one boss creature', () => {
    const encounter = getBossEncounter('big-boss-trolliver');
    const character = createCharacter('Tester', 4);
    character.level = 100;
    const huntId = bossHuntId(encounter.id);
    const session = startSession(character, huntId, 42);
    expect(session.active).toHaveLength(1);
    expect(session.active[0]?.monsterId).toBe(encounter.monsterId);
    expect(session.status).toBe('active');
  });

  it('records a 20-hour cooldown after kill', () => {
    const character = createCharacter('Tester', 4);
    const now = Date.now();
    recordBossKill(character, 'ferumbras', now);
    expect(character.bossCooldowns?.ferumbras).toBe(now + BOSS_COOLDOWN_MS);
    expect(bossOnCooldown(character, 'ferumbras', now + 1000)).toBe(true);
    expect(bossOnCooldown(character, 'ferumbras', now + BOSS_COOLDOWN_MS)).toBe(false);
  });
});
