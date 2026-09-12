import { describe, expect, it } from 'vitest';
import { itemsById } from '@tibia-idle/data';
import { bestLoadout, createCharacter } from '../src/index.js';

function equippedNames(vocationId: number, weapon?: 'axe' | 'sword' | 'club') {
  const character = createCharacter('Starter', vocationId);
  if (weapon) character.startWeapon = weapon;
  const loadout = bestLoadout(character, 3_000);
  return Object.fromEntries(Object.entries(loadout).map(([slot, id]) => [slot, itemsById.get(id!)?.name ?? 'missing']));
}

describe('starter loadout', () => {
  it('starts a knight with leather gear, a basic weapon and wooden shield', () => {
    const names = equippedNames(4, 'sword');
    expect(names.head).toBe('leather helmet');
    expect(names.armor).toBe('leather armor');
    expect(names.legs).toBe('leather legs');
    expect(names.feet).toBe('leather boots');
    expect(names.left).toBe('sword');
    expect(names.right).toBe('wooden shield');
  });

  it('starts casters and paladins with only their basic weapon family', () => {
    expect(equippedNames(1).left).toBe('wand of vortex');
    expect(equippedNames(2).left).toBe('snakebite rod');
    expect(equippedNames(3).left).toBe('bow');
    expect(equippedNames(3).ammo).toBe('simple arrow');
  });

  it('does not hand a monk a weapon', () => {
    expect(equippedNames(9).left).toBeUndefined();
  });
});
