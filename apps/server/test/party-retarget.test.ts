import { describe, expect, it } from 'vitest';
import {
  createCharacter, deriveStats, expForLevel, SPELLS, startSession, TICK_MS,
} from '@tibia-idle/sim';
import { settleParty } from '../src/party-settlement.js';

const START = 1_700_000_000_000;

function member(id: number) {
  const character = createCharacter('Retarget ' + id, 4);
  character.level = 40;
  character.experience = expForLevel(40);
  character.skills.sword = { level: 70, tries: 0 };
  character.equipment.left = 3271;
  character.health = deriveStats(character).maxHealth;
  character.policy.fleeAt = 0;
  character.policy.stopWhenOutOfSupplies = false;
  character.policy.healthPotionAt = 0;
  character.policy.manaPotionAt = 0;
  character.policy.healSpellId = '';
  character.policy.disabledSpells = SPELLS.map((spell) => spell.id);

  const session = startSession(character, 'venore-rotworm-cave', id);
  session.startedAt = START;
  // Keep the test about monster aggro only: nobody kills a creature this tick.
  session.playerAttackCooldown = 100_000;
  return { id, session, settledAt: START };
}

describe('party monster retarget', () => {
  it('moves a dead member’s remaining monsters to the nearest living member', () => {
    const leader = member(1);
    const fallen = member(2);
    const farMember = member(3);

    const leaderBefore = leader.session.active.length;
    const fallenBefore = fallen.session.active.length;
    const farBefore = farMember.session.active.length;

    // Slot 2 is the lower-left formation seat. The principal in the centre is
    // closer than slot 3 on the lower-right, so every remaining creature should
    // switch to the principal when slot 2 dies.
    fallen.session.character.health = -100;

    settleParty([leader, fallen, farMember], START + TICK_MS);

    expect(fallen.session.status).toBe('died');
    expect(fallen.session.active).toHaveLength(0);
    expect(leader.session.status).toBe('active');
    expect(farMember.session.status).toBe('active');
    expect(leader.session.active).toHaveLength(leaderBefore + fallenBefore);
    expect(farMember.session.active).toHaveLength(farBefore);

    const uids = leader.session.active.map((monster) => monster.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});
