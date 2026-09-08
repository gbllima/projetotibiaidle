import { getVocation } from '@tibia-idle/data';
import { deriveStats, weaponDamageRange } from './character.js';
import { baseDamageHealing } from './formulas.js';
import { referenceCharacter } from './reference.js';
import { chooseSpell, spellDamage } from './spells.js';
import { bestRune, runeDamage } from './runes.js';
import { wandAttack } from './wands.js';
import { WAVE_PACK } from './waves.js';
import { huntThroughput, requiredDamagePerSecond } from './throughput.js';
import type { CharacterState } from './types.js';

/**
 * Closed-form estimates.
 *
 * The tick loop is the source of truth, but a lot of the game needs a number
 * *before* committing to a simulation: which hunts to offer the player, what
 * level a zone really wants, whether a gear change is an upgrade. Running an
 * hour of ticks for every one of those would be far too slow, so these
 * functions approximate the same maths analytically.
 */

/**
 * Average damage per second across `targets` monsters.
 *
 * Mirrors the rotation in `playerTurn`: auto-attack and spell run on separate
 * cooldowns. Casters fire the equipped wand/rod between spells.
 */
export function estimateDamagePerSecond(character: CharacterState, targets = 1): number {
  const stats = deriveStats(character);
  const weaponRange = weaponDamageRange(character, stats);
  let total = 0;

  const spell = chooseSpell(character.vocationId, character.level, Infinity, targets, character.policy);
  let groupDps = 0;
  if (spell) {
    const range = spellDamage(
      spell,
      character.level,
      character.magicLevel,
      baseDamageHealing,
      weaponRange,
      { attackSkill: stats.attackSkill, weaponDamage: stats.attackValue },
    );
    const average = (range.min + range.max) / 2;
    const hit = spell.area ? targets : 1;
    groupDps = (average * hit) / (spell.cooldown / 1000);
  }
  if ((character.policy.runeId ?? -1) >= 0) {
    const rune = bestRune(character.vocationId, character.level, character.magicLevel, targets);
    if (rune) {
      const range = runeDamage(rune, character.level, character.magicLevel);
      const hit = rune.area ? targets : 1;
      const runeDps = ((range.min + range.max) / 2 * hit) / (rune.cooldown / 1000);
      groupDps = Math.max(groupDps, runeDps);
    }
  }
  total += groupDps;

  if (stats.isMagic) {
    const wand = wandAttack(character);
    if (wand) total += (wand.min + wand.max) / 2 / (stats.attackSpeed / 1000);
  } else {
    total += (weaponRange.min + weaponRange.max) / 2 / (stats.attackSpeed / 1000);
  }
  return total;
}

/**
 * Effective damage per second, discounted for the average monster's defenses
 * in a zone. Physical attackers lose the most, because armour and shields only
 * apply to physical damage.
 */
export function estimateEffectiveDps(character: CharacterState, huntId: string): number {
  const { monsters } = huntThroughput(huntId);
  if (monsters.length === 0) return estimateDamagePerSecond(character, 1);
  const raw = estimateDamagePerSecond(character, WAVE_PACK[4] ?? 11);

  const stats = deriveStats(character);
  let retained = 0;
  for (const monster of monsters) {
    const mitigation = Math.min(45, monster.mitigation * 1.5) / 100;
    const physical = stats.isMagic ? 0 : (monster.armor * 0.75 + monster.defense * 0.75);
    // Element resistances average out across a mixed pool; take the mean.
    const elemental = stats.isMagic
      ? Object.values(monster.elements).reduce((a, b) => a + b, 0) / 10 / 100
      : (monster.elements['COMBAT_PHYSICALDAMAGE'] ?? 0) / 100;
    retained += Math.max(0.05, (1 - mitigation) * (1 - elemental)) * Math.max(0, 1 - physical / Math.max(1, raw));
  }
  return raw * (retained / monsters.length);
}

/**
 * The level at which a character of this vocation can keep up with a zone's
 * respawn rate.
 *
 * This replaces the `Level` field in hunting_places.json, which turns out to be
 * a minimum rather than a recommendation - it lists Kha'labal Terramites Cave,
 * a zone of 365 hp monsters yielding 80k xp/h, as level 8.
 */
export function recommendedLevel(huntId: string, vocationId: number): number {
  const required = requiredDamagePerSecond(huntId);
  if (required <= 0) return 8;

  let low = 8;
  let high = 1500;
  const cache = new Map<number, number>();
  const dpsAt = (level: number): number => {
    const cached = cache.get(level);
    if (cached !== undefined) return cached;
    const value = estimateEffectiveDps(referenceCharacter(vocationId, level), huntId);
    cache.set(level, value);
    return value;
  };

  if (dpsAt(high) < required) return high;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dpsAt(mid) >= required) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Lowest recommended level across the vocations a zone lists. */
export function recommendedLevelForHunt(huntId: string, vocationIds: readonly number[]): number {
  const levels = vocationIds.map((id) => recommendedLevel(huntId, id));
  return levels.length ? Math.min(...levels) : 8;
}

/** Vocation ids by the names used in hunting_places.json. */
export const VOCATION_BY_NAME: Record<string, number> = {
  knight: 4, 'elite knight': 4,
  paladin: 3, 'royal paladin': 3,
  sorcerer: 1, 'master sorcerer': 1,
  druid: 2, 'elder druid': 2,
  monk: 9, 'exalted monk': 9,
};

export function vocationIdsFor(names: readonly string[]): number[] {
  const ids = new Set<number>();
  for (const name of names) {
    const id = VOCATION_BY_NAME[name];
    if (id) ids.add(id);
  }
  return ids.size ? [...ids] : [getVocation(4).id];
}
