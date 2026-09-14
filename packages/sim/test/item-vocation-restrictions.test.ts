import { items, itemsById, type Item } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import { canEquipFor, itemAllowedVocationIds } from '../src/index.js';

function named(name: string): Item {
  const item = items.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!item) throw new Error(`Missing test item: ${name}`);
  return item;
}

describe('item vocation restrictions', () => {
  it('treats unrestricted melee weapons as Knight weapons', () => {
    const spikeSword = itemsById.get(3271);
    expect(spikeSword?.name).toBe('spike sword');
    expect(spikeSword?.vocations).toEqual([]);
    expect(itemAllowedVocationIds(spikeSword!)).toEqual([4, 8]);
    expect(canEquipFor(spikeSword!, 4, 100)).toBe(true); // Knight
    expect(canEquipFor(spikeSword!, 8, 100)).toBe(true); // Elite Knight
    expect(canEquipFor(spikeSword!, 2, 100)).toBe(false); // Druid
    expect(canEquipFor(spikeSword!, 1, 100)).toBe(false); // Sorcerer
    expect(canEquipFor(spikeSword!, 3, 100)).toBe(false); // Paladin
  });

  it('keeps the main weapon families separated by vocation', () => {
    const bow = named('bow');
    const wand = named('wand of vortex');
    const rod = named('snakebite rod');

    expect(canEquipFor(bow, 3, 100)).toBe(true);
    expect(canEquipFor(bow, 4, 100)).toBe(false);

    expect(canEquipFor(wand, 1, 100)).toBe(true);
    expect(canEquipFor(wand, 2, 100)).toBe(false);

    expect(canEquipFor(rod, 2, 100)).toBe(true);
    expect(canEquipFor(rod, 1, 100)).toBe(false);
  });

  it('does not let a base vocation use a promoted-only item', () => {
    const source = itemsById.get(3271)!;
    const eliteOnly: Item = {
      ...source,
      id: -3271,
      levelRequired: 0,
      vocations: ['elite knight'],
    };

    expect(itemAllowedVocationIds(eliteOnly)).toEqual([8]);
    expect(canEquipFor(eliteOnly, 4, 100)).toBe(false);
    expect(canEquipFor(eliteOnly, 8, 100)).toBe(true);
  });
});
