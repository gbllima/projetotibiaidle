import { describe, expect, it } from 'vitest';
import { itemsByName } from '@tibia-idle/data';
import {
  advance, ammoDamageRange, ammoProfile, ammoSplashVictims, createCharacter, defaultSupplies,
  deriveStats, isInAmmoSplash, packStandTiles, splitAmmoDamage, startSession,
} from '../src/index.js';

const ARROW = itemsByName.get('arrow')!;
const BURST = itemsByName.get('burst arrow')!;
const FLAMING = itemsByName.get('flaming arrow')!;
const DIAMOND = itemsByName.get('diamond arrow')!;

describe('paladin ammo', () => {
  it('packs arrows for a distance vocation', () => {
    const paladin = createCharacter('Ranger', 3);
    const packs = defaultSupplies(paladin, 1);
    expect(packs.some((stack) => stack.itemId === ARROW.id && stack.count > 0)).toBe(true);
    const knight = createCharacter('Tank', 4);
    expect(defaultSupplies(knight, 1).some((stack) => stack.itemId === ARROW.id)).toBe(false);
  });

  it('consumes arrows on each swing and stops when they run out', () => {
    const paladin = createCharacter('Ranger', 3);
    paladin.policy.healthPotionId = -1;
    paladin.policy.manaPotionId = -1;
    paladin.policy.healSpellId = '';
    paladin.policy.autoAttack = true;
    paladin.policy.stopWhenOutOfSupplies = false;
    paladin.equipment.left = itemsByName.get('bow')?.id ?? paladin.equipment.left;
    paladin.equipment.ammo = ARROW.id;
    paladin.supplies = [{ itemId: ARROW.id, count: 6 }];

    const session = startSession(paladin, 'swamp-trolls', 11n);
    advance(session, 800, { maxEvents: 0, creatureFlee: false });
    const left = session.character.supplies.find((stack) => stack.itemId === ARROW.id)?.count ?? 0;
    expect(left).toBeLessThan(6);
    expect(session.totals.supplyValue).toBeGreaterThan(0);
    if (left === 0) expect(session.status).toBe('out_of_supplies');
  });

  it('does not invent ammo ids when the bag is empty', async () => {
    const { ammoToConsume } = await import('../src/index.js');
    const paladin = createCharacter('Ranger', 3);
    paladin.equipment.ammo = ARROW.id;
    paladin.supplies = [];
    expect(ammoToConsume(paladin)).toBeNull();
  });

  it('empty quiver prefers normal arrows over burst in the bag', async () => {
    const { ammoToConsume } = await import('../src/index.js');
    const paladin = createCharacter('Ranger', 3);
    paladin.equipment.ammo = undefined;
    paladin.supplies = [
      { itemId: BURST.id, count: 50 },
      { itemId: ARROW.id, count: 50 },
    ];
    expect(ammoToConsume(paladin)).toBe(ARROW.id);
  });
});

describe('Crystal ammo splash areas', () => {
  it('burst3 is a 3×3 around the impact (Chebyshev ≤ 1)', () => {
    expect(isInAmmoSplash('burst3', 5, 5, 5, 5)).toBe(true);
    expect(isInAmmoSplash('burst3', 5, 5, 6, 6)).toBe(true);
    expect(isInAmmoSplash('burst3', 5, 5, 4, 5)).toBe(true);
    expect(isInAmmoSplash('burst3', 5, 5, 7, 5)).toBe(false);
    expect(isInAmmoSplash('burst3', 5, 5, 5, 7)).toBe(false);
  });

  it('diamond5 excludes the far corners of the 5×5', () => {
    expect(isInAmmoSplash('diamond5', 5, 5, 5, 5)).toBe(true);
    expect(isInAmmoSplash('diamond5', 5, 5, 7, 5)).toBe(true);
    expect(isInAmmoSplash('diamond5', 5, 5, 7, 7)).toBe(false);
    expect(isInAmmoSplash('diamond5', 5, 5, 6, 7)).toBe(true);
  });

  it('storm5 matches the 13-tile cross', () => {
    expect(isInAmmoSplash('storm5', 5, 5, 5, 3)).toBe(true);
    expect(isInAmmoSplash('storm5', 5, 5, 3, 5)).toBe(true);
    expect(isInAmmoSplash('storm5', 5, 5, 6, 6)).toBe(true); // diagonal ring is filled
    expect(isInAmmoSplash('storm5', 5, 5, 7, 7)).toBe(false);
    expect(isInAmmoSplash('storm5', 5, 5, 7, 6)).toBe(false);
  });

  it('splash victims are only on the Crystal 3×3 of the impact seat, not the whole pack', () => {
    const pack = Array.from({ length: 8 }, (_, i) => ({
      uid: i + 1,
      monsterId: 'rat',
      health: 100,
      maxHealth: 100,
      tileX: 0,
      tileY: 0,
      attackCooldowns: [],
      healCooldown: 0,
    }));
    const tiles = packStandTiles(pack);
    for (const monster of pack) {
      const tile = tiles.get(monster.uid)!;
      monster.tileX = tile.x;
      monster.tileY = tile.y;
    }
    const focus = pack[0]!;
    const splash = ammoSplashVictims(pack, focus, 'burst3');
    expect(splash.some((m) => m.uid === focus.uid)).toBe(true);
    expect(splash.length).toBeGreaterThan(1);
    expect(splash.length).toBeLessThan(pack.length);
    expect(splash.length).toBeLessThanOrEqual(9);

    const focusTile = { x: focus.tileX, y: focus.tileY };
    for (const victim of splash) {
      expect(isInAmmoSplash('burst3', focusTile.x, focusTile.y, victim.tileX, victim.tileY)).toBe(true);
    }
    const far = pack.find((m) => !isInAmmoSplash('burst3', focusTile.x, focusTile.y, m.tileX, m.tileY));
    expect(far).toBeTruthy();
    expect(splash.some((m) => m.uid === far!.uid)).toBe(false);
  });
});

describe('special ammunition', () => {
  it('profiles burst / diamond / elemental / storm arrows from Crystal', () => {
    const burst = ammoProfile(BURST.id)!;
    expect(burst.area).toBe(true);
    expect(burst.areaShape).toBe('burst3');
    expect(burst.effect).toBe('CONST_ME_EXPLOSIONAREA');
    expect(burst.shoot).toBe('CONST_ANI_BURSTARROW');

    const diamond = ammoProfile(DIAMOND.id)!;
    expect(diamond.area).toBe(true);
    expect(diamond.areaShape).toBe('diamond5');
    expect(diamond.diamondFormula).toBe(true);
    expect(diamond.level).toBe(150);

    const flaming = ammoProfile(FLAMING.id)!;
    expect(flaming.elementAttack).toBe(14);
    expect(flaming.elementType).toBe('COMBAT_FIREDAMAGE');
    expect(flaming.shoot).toContain('FLAMMING');

    const firestorm = ammoProfile(53169)!;
    expect(firestorm.area).toBe(true);
    expect(firestorm.areaShape).toBe('storm5');
    expect(firestorm.elementType).toBe('COMBAT_FIREDAMAGE');
    expect(firestorm.level).toBe(125);

    const poison = ammoProfile(3448)!;
    expect(poison.poison?.ticks).toBeGreaterThan(0);
  });

  it('splits elemental ammo damage physical/element', () => {
    const flaming = ammoProfile(FLAMING.id)!;
    const parts = splitAmmoDamage(flaming, 100);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.damageType).toBe('COMBAT_PHYSICALDAMAGE');
    expect(parts[1]!.damageType).toBe('COMBAT_FIREDAMAGE');
    expect(parts[0]!.amount + parts[1]!.amount).toBe(100);
  });

  it('burst arrow hits impact neighbors in one shot, not every monster', () => {
    const paladin = createCharacter('Bomber', 3);
    paladin.level = 40;
    paladin.skills.distance.level = 60;
    paladin.policy.healthPotionId = -1;
    paladin.policy.manaPotionId = -1;
    paladin.policy.healSpellId = '';
    paladin.policy.runeId = -1;
    paladin.policy.autoAttack = true;
    paladin.equipment.left = itemsByName.get('bow')?.id ?? paladin.equipment.left;
    paladin.equipment.ammo = BURST.id;
    paladin.supplies = [{ itemId: BURST.id, count: 40 }];

    const session = startSession(paladin, 'swamp-trolls', 42n);
    expect(session.active.length).toBeGreaterThan(2);

    const events = advance(session, 24, { maxEvents: 500, creatureFlee: false });
    const hits = events.filter((e) => e.type === 'player_attack' && e.itemId === BURST.id && (e.amount ?? 0) > 0);
    expect(hits.some((e) => e.area)).toBe(true);

    const byTick = new Map<number, Set<number>>();
    for (const hit of hits) {
      if (hit.uid === undefined) continue;
      const set = byTick.get(hit.tick) ?? new Set();
      set.add(hit.uid);
      byTick.set(hit.tick, set);
    }
    const splashSizes = [...byTick.values()].map((uids) => uids.size);
    expect(splashSizes.some((n) => n > 1)).toBe(true);
    expect(splashSizes.every((n) => n <= 9)).toBe(true);
    expect(splashSizes.every((n) => n < session.active.length || session.active.length <= 3)).toBe(true);

    const announce = events.find((e) => e.type === 'player_attack' && e.area && e.areaShape === 'burst3' && e.shoot);
    expect(announce).toBeTruthy();
    expect(announce!.impactX).toBeTypeOf('number');
    expect(announce!.impactY).toBeTypeOf('number');
    expect(announce!.effect).toBe('CONST_ME_EXPLOSIONAREA');
  });

  it('normal arrows stay single-target', () => {
    const paladin = createCharacter('Steady', 3);
    paladin.level = 40;
    paladin.skills.distance.level = 60;
    paladin.policy.healthPotionId = -1;
    paladin.policy.manaPotionId = -1;
    paladin.policy.healSpellId = '';
    paladin.policy.runeId = -1;
    paladin.policy.autoAttack = true;
    paladin.equipment.left = itemsByName.get('bow')?.id ?? paladin.equipment.left;
    paladin.equipment.ammo = ARROW.id;
    paladin.supplies = [{ itemId: ARROW.id, count: 40 }];

    const session = startSession(paladin, 'swamp-trolls', 99n);
    expect(session.active.length).toBeGreaterThan(1);
    const events = advance(session, 40, { maxEvents: 500, creatureFlee: false });
    const hits = events.filter((e) => e.type === 'player_attack' && e.itemId === ARROW.id && (e.amount ?? 0) > 0);
    expect(hits.length).toBeGreaterThan(0);
    const byTick = new Map<number, Set<number>>();
    for (const hit of hits) {
      if (hit.uid === undefined) continue;
      const set = byTick.get(hit.tick) ?? new Set();
      set.add(hit.uid);
      byTick.set(hit.tick, set);
    }
    expect([...byTick.values()].every((uids) => uids.size <= 1)).toBe(true);
  });

  it('diamond formula yields higher ceiling than standard distance', () => {
    const paladin = createCharacter('Elite', 3);
    paladin.level = 150;
    paladin.skills.distance.level = 100;
    const stats = deriveStats(paladin);
    const diamond = ammoProfile(25757)!;
    const normal = ammoProfile(ARROW.id)!;
    const dRange = ammoDamageRange(paladin, stats, diamond);
    const nRange = ammoDamageRange(paladin, stats, normal);
    expect(dRange.max).toBeGreaterThan(nRange.max);
    expect(dRange.min).toBeGreaterThanOrEqual(nRange.min);
  });
});
