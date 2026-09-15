import { describe, expect, it } from 'vitest';
import {
  createCharacter,
  huntMultipliers,
  MULTIPLAYER_PARTY_BOOST_PREFIX,
  MULTIPLAYER_PARTY_XP_BONUS,
  staminaMultiplier,
} from '../src/index.js';

describe('multiplayer party XP', () => {
  it('keeps VIP/free rates individual and adds only the balanced social bonus', () => {
    const now = 1_700_000_000_000;
    const free = createCharacter('Free Hunter', 4);
    free.premium = false;
    free.vipUntil = 0;
    free.partySlots = 5;

    const vip = createCharacter('Vip Hunter', 4);
    vip.premium = true;
    vip.vipUntil = now + 86_400_000;
    vip.partySlots = 5;

    // Even with party levels present, the cross-account marker uses the single
    // social bonus instead of stacking the older same-world party-share bonus.
    const freeRate = huntMultipliers(
      free,
      '__no_monster__',
      now,
      [150, 120],
      MULTIPLAYER_PARTY_BOOST_PREFIX,
    ).experience;
    const vipRate = huntMultipliers(
      vip,
      '__no_monster__',
      now,
      [80, 120],
      MULTIPLAYER_PARTY_BOOST_PREFIX,
    ).experience;

    expect(freeRate).toBeCloseTo(1 + MULTIPLAYER_PARTY_XP_BONUS, 8);
    expect(vipRate).toBeCloseTo(1.05 * (1 + MULTIPLAYER_PARTY_XP_BONUS), 8);
    expect(staminaMultiplier(2520, false)).toBe(1);
    expect(staminaMultiplier(2520, true)).toBe(1.5);
  });

  it('preserves the daily boosted-creature id inside the multiplayer marker', () => {
    const character = createCharacter('Social Hunter', 4);
    const boosted = huntMultipliers(
      character,
      'rat',
      0,
      [],
      `${MULTIPLAYER_PARTY_BOOST_PREFIX}rat`,
    );

    expect(boosted.experience).toBeCloseTo((1 + MULTIPLAYER_PARTY_XP_BONUS) * 1.5, 8);
    expect(boosted.loot).toBeCloseTo(1.25, 8);
  });
});
