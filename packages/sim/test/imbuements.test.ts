import { describe, expect, it } from 'vitest';
import {
  absorbPercent, advance, combatProcs, createCharacter, deriveStats, imbueAbsorbPercent,
  imbueDamageConvert, imbueSkillBonus, imbueVibrancyChance, IMBUEMENTS, itemImbuementSlots, skillLevel, startSession,
} from '../src/index.js';

describe('crystal imbuements', () => {
  it('lists the full Crystal shrine catalog', () => {
    expect(IMBUEMENTS.length).toBe(24);
    expect(IMBUEMENTS.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'strike', 'reap', 'venom', 'electrify', 'scorch', 'frost',
      'lich_shroud', 'snake_skin', 'cloud_fabric', 'dragon_hide', 'demon_presence', 'quara_scale',
      'vampirism', 'void', 'chop', 'bash', 'slash', 'precision', 'punch',
      'epiphany', 'blockade', 'swiftness', 'featherweight', 'vibrancy',
    ]));
  });

  it('converts physical hits with Scorch', () => {
    const character = createCharacter('Kina', 4);
    character.imbuements = [{
      slot: 'left', index: 0, type: 'scorch', tier: 3, expiresAt: Date.now() + 3_600_000,
    }];
    const convert = imbueDamageConvert(character);
    expect(convert?.combat).toBe('COMBAT_FIREDAMAGE');
    expect(convert?.percent).toBe(50);
  });

  it('raises skills and magic from shrine imbues', () => {
    const character = createCharacter('Monk', 9);
    character.skills.fist.level = 40;
    character.magicLevel = 10;
    character.imbuements = [
      { slot: 'left', type: 'punch', tier: 3, expiresAt: Date.now() + 3_600_000 },
      { slot: 'head', type: 'epiphany', tier: 2, expiresAt: Date.now() + 3_600_000 },
    ];
    expect(imbueSkillBonus(character, 'fist')).toBe(4);
    expect(skillLevel(character, 'fist')).toBeGreaterThanOrEqual(44);
    expect(combatProcs(character).magicLevel).toBe(12);
  });

  it('absorbs elemental hits with Dragon Hide', () => {
    const character = createCharacter('Kina', 4);
    character.imbuements = [{
      slot: 'armor', type: 'dragon_hide', tier: 3, expiresAt: Date.now() + 3_600_000,
    }];
    expect(imbueAbsorbPercent(character, 'COMBAT_FIREDAMAGE')).toBe(15);
    expect(absorbPercent(character, 'COMBAT_FIREDAMAGE')).toBeGreaterThanOrEqual(15);
  });

  it('raises capacity with Featherweight', () => {
    const character = createCharacter('Kina', 4);
    character.level = 50;
    const before = deriveStats(character).capacity;
    character.imbuements = [{
      slot: 'backpack', type: 'featherweight', tier: 3, expiresAt: Date.now() + 3_600_000,
    }];
    expect(deriveStats(character).capacity).toBe(Math.floor(before * 1.15));
  });

  it('deals converted fire damage in a hunt', () => {
    const character = createCharacter('Kina', 4);
    character.level = 40;
    character.skills.sword.level = 50;
    character.equipment.left = 3271; // spike sword — has imbue slots
    expect(itemImbuementSlots(3271)).toBeGreaterThan(0);
    character.imbuements = [{
      slot: 'left', type: 'scorch', tier: 3, expiresAt: Date.now() + 3_600_000,
    }];
    character.policy.autoAttack = true;
    character.policy.fleeAt = 0;
    character.policy.stopWhenOutOfSupplies = false;
    character.policy.haste = false;
    character.policy.food = false;
    character.policy.cure = false;
    character.policy.disabledSpells = [];
    const session = startSession(character, 'venore-rotworm-cave', 91n);
    session.startedAt = Date.now();
    const events = advance(session, 40, { maxEvents: 200, creatureFlee: false });
    expect(session.totals.damageDealt).toBeGreaterThan(0);
    expect(events.some((event) => (
      event.type === 'player_attack' && event.damageType === 'COMBAT_FIREDAMAGE' && (event.amount ?? 0) > 0
    ))).toBe(true);
  });

  it('exposes Vibrancy paralyze deflect chance from boots', () => {
    const character = createCharacter('Kina', 4);
    expect(imbueVibrancyChance(character)).toBe(0);
    character.imbuements = [{
      slot: 'feet', type: 'vibrancy', tier: 3, expiresAt: Date.now() + 3_600_000,
    }];
    expect(imbueVibrancyChance(character)).toBe(50);
  });
});
