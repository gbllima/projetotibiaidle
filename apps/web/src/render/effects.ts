import { monstersById, type CombatType } from '@tibia-idle/data';
import type { SimEvent } from '@tibia-idle/sim';
import MAGIC_EFFECTS from './magic-effects.json' with { type: 'json' };

const ME = MAGIC_EFFECTS as Record<string, number>;

const BY_DAMAGE: Record<CombatType, number> = {
  COMBAT_PHYSICALDAMAGE: ME.DRAWBLOOD ?? 1,
  COMBAT_ENERGYDAMAGE: ME.ENERGYHIT ?? 12,
  COMBAT_EARTHDAMAGE: ME.HITBYPOISON ?? 17,
  COMBAT_FIREDAMAGE: ME.HITBYFIRE ?? 16,
  COMBAT_LIFEDRAIN: ME.MAGIC_RED ?? 14,
  COMBAT_MANADRAIN: ME.LOSEENERGY ?? 2,
  COMBAT_DROWNDAMAGE: ME.WATERSPLASH ?? 54,
  COMBAT_ICEDAMAGE: ME.ICEATTACK ?? 44,
  COMBAT_HOLYDAMAGE: ME.HOLYDAMAGE ?? 40,
  COMBAT_DEATHDAMAGE: ME.MORTAREA ?? 18,
  COMBAT_HEALING: ME.MAGIC_BLUE ?? 13,
};

export type EffectTarget = 'player' | 'target';

export interface Burst {
  id: number;
  on: EffectTarget;
}

/** Knight / monk basic swing — custom `/assets/attack/*` strip only, no whirlwind or blood. */
export function isCustomMeleeSwing(event: SimEvent): boolean {
  return event.type === 'player_attack'
    && Boolean(event.attackEffect)
    && !event.area
    && !event.areaShape
    && !event.words;
}

/** Tibia/Baiak-style animated text colors — bright fills for readability on terrain. */
export function damageTint(type: CombatType | undefined, critical = false): number {
  if (critical) return 0xfff06a; // yellow-white crit
  switch (type) {
    case 'COMBAT_FIREDAMAGE': return 0xff8c1a; // orange
    case 'COMBAT_ENERGYDAMAGE': return 0xd24dff; // electric purple
    case 'COMBAT_EARTHDAMAGE': return 0x5dff5d; // light green
    case 'COMBAT_ICEDAMAGE': return 0x7ad7ff; // sky blue
    case 'COMBAT_HOLYDAMAGE': return 0xffe566; // yellow
    case 'COMBAT_DEATHDAMAGE': return 0xc8c8c8; // light grey
    case 'COMBAT_LIFEDRAIN': return 0xff3333;
    case 'COMBAT_MANADRAIN': return 0x5a9cff;
    case 'COMBAT_DROWNDAMAGE': return 0x5ab8e8;
    case 'COMBAT_HEALING': return 0x66ff66;
    case 'COMBAT_PHYSICALDAMAGE':
    default:
      return 0xff4040; // red (blood race / player taken)
  }
}

/** Damage you deal looks white/cream on BaiakIdle — pops over dark floors. */
export function outgoingDamageTint(type: CombatType | undefined, critical = false): number {
  if (critical) return 0xfff2a0;
  switch (type) {
    case 'COMBAT_FIREDAMAGE': return 0xff9a2e;
    case 'COMBAT_ENERGYDAMAGE': return 0xe070ff;
    case 'COMBAT_EARTHDAMAGE': return 0x70ff70;
    case 'COMBAT_ICEDAMAGE': return 0x90e8ff;
    case 'COMBAT_HOLYDAMAGE': return 0xfff080;
    case 'COMBAT_DEATHDAMAGE': return 0xe0e0e0;
    case 'COMBAT_PHYSICALDAMAGE':
    default:
      return 0xffffff; // classic white hit numbers
  }
}

/** Crystal CONST_ME_* id for a combat event, or nothing if it should stay quiet. */
export function burstsFor(event: SimEvent): Burst[] {
  if (event.type === 'heal') return [{ id: ME.MAGIC_BLUE ?? 13, on: 'player' }];
  if (event.type === 'potion') return [{ id: ME.MAGIC_GREEN ?? 15, on: 'player' }];

  if (event.type === 'player_attack') {
    const bursts: Burst[] = [];
    const customSwing = isCustomMeleeSwing(event);
    // Cast flash on the knight; area HITAREA is painted on the ring by CombatScene.
    if (event.words && !event.area) bursts.push({ id: ME.MAGIC_RED ?? 14, on: 'player' });
    if (event.uid === undefined || customSwing) return bursts;
    if (event.missed) bursts.push({ id: ME.POFF ?? 3, on: 'target' });
    else if (event.blocked) bursts.push({ id: ME.BLOCKHIT ?? 4, on: 'target' });
    else if ((event.amount ?? 0) > 0) {
      // Area spells paint CONST_ME on tiles once at cast — per-victim hits are numbers only.
      const named = !event.area ? magicEffectId(event.effect) : undefined;
      if (named) bursts.push({ id: named, on: 'target' });
      else if (
        !event.area
        && (event.damageType ?? 'COMBAT_PHYSICALDAMAGE') === 'COMBAT_PHYSICALDAMAGE'
      ) {
        bursts.push({ id: ME.HITAREA ?? 10, on: 'target' });
      }
      if (!event.area) {
        bursts.push({ id: BY_DAMAGE[event.damageType ?? 'COMBAT_PHYSICALDAMAGE'] ?? 1, on: 'target' });
      }
      if (event.critical) bursts.push({ id: ME.CRITICAL_DAMAGE ?? 173, on: 'target' });
      if (event.fatal) bursts.push({ id: ME.FATAL ?? 230, on: 'target' });
    }
    return bursts;
  }

  if (event.type === 'monster_attack') {
    if (event.dodged) return [{ id: ME.DODGE ?? ME.POFF ?? 3, on: 'player' }];
    if (event.blocked) return [{ id: ME.BLOCKHIT ?? 4, on: 'player' }];
    if ((event.amount ?? 0) <= 0) return [];
    return [{ id: monsterEffect(event.monsterId, event.damageType), on: 'player' }];
  }

  if (event.type === 'condition') {
    if ((event.amount ?? 0) <= 0) return [];
    return [{ id: BY_DAMAGE[event.damageType ?? 'COMBAT_EARTHDAMAGE'] ?? 17, on: 'player' }];
  }

  if (event.type === 'buff') {
    return [{ id: ME.MAGIC_GREEN ?? 15, on: 'player' }];
  }

  return [];
}

export function magicEffectId(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  const key = name.startsWith('CONST_ME_') ? name.slice('CONST_ME_'.length) : name;
  return ME[key];
}

function monsterEffect(monsterId: string | undefined, damageType: CombatType | undefined): number {
  const monster = monstersById.get(monsterId ?? '');
  const named = monster?.attacks.find((attack) => (
    (!damageType || attack.damageType === damageType) && attack.effect
  ))?.effect;
  return magicEffectId(named) ?? BY_DAMAGE[damageType ?? 'COMBAT_PHYSICALDAMAGE'] ?? 1;
}
