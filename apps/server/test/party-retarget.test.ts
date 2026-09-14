import { describe, expect, it } from 'vitest';
import {
  createCharacter, deriveStats, expForLevel, SPELLS, startSession, TICK_MS, waveActiveLimit,
  type ActiveMonster, type HuntSession,
} from '@tibia-idle/sim';
import { settleParty } from '../src/party-settlement.js';

const START = 1_700_000_000_000;

type ReinforcementSession = HuntSession & { reinforcementQueue?: ActiveMonster[] };

function member(id: number) {
  const character = createCharacter('Retarget ' + id, 4);
  character.level = 40;
  character.experience = expForLevel(40);
  character.skills.sword = { level: 70, tries: 0 };
  character.equipment.left = 3271;
  character.health = deriveStats(character).maxHealth;
  // The test later injects an already-dead negative HP value. Use a sentinel
  // below zero so that artificial state reaches the death branch rather than
  // being intercepted by the normal flee policy first.
  character.policy.fleeAt = -1;
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

function allMonsters(session: HuntSession): ActiveMonster[] {
  const reinforcement = session as ReinforcementSession;
  return [...session.active, ...(reinforcement.reinforcementQueue ?? [])];
}

describe('party monster retarget', () => {
  it('moves a dead member’s visible and queued monsters to the nearest living member', () => {
    const leader = member(1);
    const fallen = member(2);
    const farMember = member(3);

    const leaderBefore = allMonsters(leader.session).length;
    const fallenBefore = allMonsters(fallen.session).length;
    const farBefore = allMonsters(farMember.session).length;

    // Slot 2 is the lower-left formation seat. The principal in the centre is
    // closer than slot 3 on the lower-right, so every remaining creature should
    // switch to the principal when slot 2 dies.
    fallen.session.character.health = -100;

    settleParty([leader, fallen, farMember], START + TICK_MS);

    expect(fallen.session.status).toBe('died');
    expect(allMonsters(fallen.session)).toHaveLength(0);
    expect(leader.session.status).toBe('active');
    expect(farMember.session.status).toBe('active');

    // Retargeting preserves the whole fight, including creatures that had been
    // hidden by the shared-screen reinforcement cap.
    expect(allMonsters(leader.session)).toHaveLength(leaderBefore + fallenBefore);
    expect(allMonsters(farMember.session)).toHaveLength(farBefore);
    expect(allMonsters(leader.session).length + allMonsters(farMember.session).length)
      .toBe(leaderBefore + fallenBefore + farBefore);

    // With two survivors, the same global wave-1 cap (3) is redistributed 2/1.
    expect(leader.session.active).toHaveLength(2);
    expect(farMember.session.active).toHaveLength(1);
    expect(leader.session.active.length + farMember.session.active.length).toBe(waveActiveLimit(0));

    const leaderUids = allMonsters(leader.session).map((monster) => monster.uid);
    expect(new Set(leaderUids).size).toBe(leaderUids.length);
  });
});
