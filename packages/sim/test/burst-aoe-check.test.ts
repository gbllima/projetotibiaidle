import { describe, expect, it } from 'vitest';
import { itemsByName } from '@tibia-idle/data';
import {
  advance, ammoSplashVictims, createCharacter, layoutPackMonsters, startSession,
} from '../src/index.js';

const BURST = itemsByName.get('burst arrow')!;

describe('burst arrow area damage', () => {
  it('hits the Crystal 3×3 around impact (neighbors yes, whole pack no)', () => {
    const paladin = createCharacter('Check', 3);
    paladin.level = 40;
    paladin.skills.distance.level = 60;
    paladin.policy.healthPotionId = -1;
    paladin.policy.manaPotionId = -1;
    paladin.policy.healSpellId = '';
    paladin.policy.runeId = -1;
    paladin.policy.autoAttack = true;
    paladin.policy.disabledSpells = ['divine_caldera', 'divine_missile', 'ethereal_spear', 'strong_ethereal_spear'];
    paladin.equipment.left = itemsByName.get('bow')?.id ?? paladin.equipment.left;
    paladin.equipment.ammo = BURST.id;
    paladin.supplies = [{ itemId: BURST.id, count: 30 }];

    const session = startSession(paladin, 'swamp-trolls', 42n);
    const packAtStart = session.active.length;
    expect(packAtStart).toBeGreaterThan(2);
    layoutPackMonsters(session.active);

    let found: { size: number } | null = null;

    for (let step = 0; step < 60 && !found; step += 1) {
      layoutPackMonsters(session.active);
      const focus = session.active[0];
      if (!focus) break;
      const expected = ammoSplashVictims(session.active, focus, 'burst3');

      const events = advance(session, 1, { maxEvents: 300, creatureFlee: false });
      const announce = events.find(
        (e) => e.type === 'player_attack' && e.areaShape === 'burst3' && e.shoot && e.area,
      );
      const hits = events.filter(
        (e) => e.type === 'player_attack' && e.itemId === BURST.id && (e.amount ?? 0) > 0,
      );
      if (!announce || hits.length === 0 || announce.uid === undefined) continue;

      const byUid = new Set(hits.map((h) => h.uid).filter((uid): uid is number => uid !== undefined));
      if (byUid.size === 0) continue;

      expect(announce.effect).toBe('CONST_ME_EXPLOSIONAREA');
      expect(byUid.size).toBeGreaterThanOrEqual(1);
      expect(byUid.size).toBeLessThanOrEqual(expected.length);
      // With a full pack, opposite-side seats sit outside the 3×3.
      if (packAtStart >= 6 && session.active.length >= 6) {
        expect(byUid.size).toBeLessThan(session.active.length);
      }
      found = { size: byUid.size };
    }

    expect(found).not.toBeNull();
  });
});
