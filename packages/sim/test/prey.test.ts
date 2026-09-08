import { describe, expect, it } from 'vitest';
import { monsters } from '@tibia-idle/data';
import { createCharacter } from '../src/character.js';
import {
  activatePreyMonster,
  emptyPreySlot,
  isPreyActive,
  isPreySelecting,
  preyBonusPercent,
  preyListRerollGold,
  rollPreyBonusReroll,
  rollPreyCandidates,
  rerollPreyList,
} from '../src/prey.js';

describe('prey', () => {
  it('lists nine unique candidates', () => {
    const character = createCharacter('Hunter', 1);
    const ids = monsters.slice(0, 12).map((entry) => entry.id);
    character.bestiary = Object.fromEntries(ids.map((id) => [id, 1]));
    const list = rollPreyCandidates(character, [], () => 0.1);
    expect(list).toHaveLength(9);
    expect(new Set(list).size).toBe(9);
  });

  it('uses level-based list reroll gold', () => {
    expect(preyListRerollGold(50)).toBe(7500);
    expect(preyListRerollGold(1)).toBe(150);
  });

  it('activates prey with bonus table percent', () => {
    const slot = emptyPreySlot();
    const active = activatePreyMonster(slot, 'rat', 1_000, () => 0);
    expect(active.monsterId).toBe('rat');
    expect(isPreyActive(active, 1_000)).toBe(true);
    expect(preyBonusPercent(active.bonus, active.star)).toBeGreaterThan(0);
  });

  it('rerolls bonus type at max star', () => {
    const slot = { ...emptyPreySlot(), bonus: 'damage' as const, star: 9, monsterId: 'rat', expiresAt: 9_999 };
    const rolled = rollPreyBonusReroll(slot, () => 0.99);
    expect(rolled.star).toBe(9);
    expect(rolled.bonus).not.toBe('damage');
  });

  it('enters selection after list reroll', () => {
    const character = createCharacter('Hunter', 1);
    const ids = monsters.slice(0, 8).map((entry) => entry.id);
    character.bestiary = Object.fromEntries(ids.map((id) => [id, 1]));
    const next = rerollPreyList(emptyPreySlot(), character, [], 1_000, () => 0.2);
    expect(isPreySelecting(next, 1_000)).toBe(true);
    expect(next.candidates.length).toBeGreaterThan(0);
  });
});
