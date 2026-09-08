import { describe, expect, it } from 'vitest';
import { createCharacter, huntMultipliers, partyExperienceShare, setWorldEvent } from '../src/index.js';

describe('party experience share', () => {
  it('does nothing with a single hunter or locked slots', () => {
    expect(partyExperienceShare([12], 8, 1)).toBe(1);
    expect(partyExperienceShare([], 8, 3)).toBe(1);
  });

  it('adds 20% for two in-range members and 30% for three', () => {
    expect(partyExperienceShare([8], 8, 2)).toBeCloseTo(1.2);
    expect(partyExperienceShare([8, 9], 8, 3)).toBeCloseTo(1.3);
  });

  it('ignores mates outside the 2/3 level range', () => {
    expect(partyExperienceShare([50], 8, 3)).toBe(1);
    expect(partyExperienceShare([8, 50], 8, 3)).toBeCloseTo(1.2);
  });

  it('caps sharing by unlocked party slots', () => {
    expect(partyExperienceShare([8, 8, 8, 8], 8, 2)).toBeCloseTo(1.2);
    expect(partyExperienceShare([8, 8, 8, 8, 8], 8, 6)).toBeCloseTo(1.6);
  });

  it('feeds hunt multipliers instead of a fake slot bonus', () => {
    setWorldEvent(null);
    const character = createCharacter('Party', 4);
    character.partySlots = 3;
    const alone = huntMultipliers(character, 'rat');
    const shared = huntMultipliers(character, 'rat', 0, [8]);
    expect(shared.experience).toBeCloseTo(alone.experience * 1.2);
  });
});
