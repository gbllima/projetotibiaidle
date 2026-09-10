import { describe, expect, it } from 'vitest';
import { canAllyStrike, chooseHeroTargetForMonster, chooseMonsterTargetForAlly, desiredCombatRange, isMeleeVocation } from './combatAi.js';

describe('party combat targeting', () => {
  it('prefers the closest ally when the monster is nearer to that ally than to the player', () => {
    const player = { tileX: 6, tileY: 5 };
    const allies = [
      { tileX: 8, tileY: 4 },
      { tileX: 3, tileY: 8 },
    ];
    const monster = { tileX: 8, tileY: 5 };

    expect(chooseHeroTargetForMonster(monster, player, allies)).toEqual(allies[0]);
  });

  it('prefers the closest monster when an ally is in melee range but the player is further away', () => {
    const ally = { tileX: 7, tileY: 6 };
    const player = { tileX: 1, tileY: 1 };
    const monsters = [
      { tileX: 7, tileY: 7 },
      { tileX: 3, tileY: 3 },
    ];

    expect(chooseMonsterTargetForAlly(ally, player, monsters)).toEqual(monsters[0]);
  });

  it('spaces melee, paladin and mage party roles into distinct combat lanes', () => {
    expect(isMeleeVocation(4)).toBe(true);
    expect(desiredCombatRange(4)).toBe(1);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 6, tileY: 5 }, 4)).toBe(true);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 8, tileY: 5 }, 4)).toBe(false);

    expect(desiredCombatRange(3)).toBe(3);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 8, tileY: 5 }, 3)).toBe(true);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 9, tileY: 5 }, 3)).toBe(false);

    expect(desiredCombatRange(2)).toBe(4);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 9, tileY: 5 }, 2)).toBe(true);
    expect(canAllyStrike({ tileX: 5, tileY: 5 }, { tileX: 10, tileY: 5 }, 2)).toBe(false);
  });
});
