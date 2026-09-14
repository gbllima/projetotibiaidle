import type { CharacterState, HuntSession } from '@tibia-idle/sim';
import type { Database } from './db.js';

/**
 * Canonical starter lookTypes used by each vocation.
 * Promoted vocations keep the visual identity of their base vocation.
 *
 * Monk does not have a dedicated starter outfit in the imported catalog, so
 * Oriental is used as the martial-arts class look instead of Citizen.
 */
const BASE_VOCATION: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 1,
  6: 2,
  7: 3,
  8: 4,
  9: 9,
  10: 9,
};

const CLASS_LOOK: Record<number, { m: number; f: number }> = {
  1: { m: 130, f: 138 }, // Mage
  2: { m: 144, f: 148 }, // Druid
  3: { m: 129, f: 137 }, // Hunter / Paladin
  4: { m: 131, f: 139 }, // Knight
  9: { m: 146, f: 150 }, // Oriental / Monk
};

/** Old automatic looks that were assigned before the vocation mapping fix. */
const LEGACY_AUTOMATIC_LOOK: Record<number, number> = {
  1: 130,
  2: 144,
  3: 137, // female Hunter was incorrectly used for every Paladin
  4: 131,
  9: 128, // Citizen placeholder
};

function repairAutomaticAppearance(character: CharacterState): boolean {
  const base = BASE_VOCATION[character.vocationId] ?? character.vocationId;
  const looks = CLASS_LOOK[base];
  const legacy = LEGACY_AUTOMATIC_LOOK[base];
  const appearance = character.appearance;
  if (!looks || legacy === undefined || !appearance) return false;

  // Only migrate the exact look that the old character creator assigned.
  // This deliberately leaves store/outfit selections alone.
  if (appearance.outfit !== legacy) return false;

  const gender = character.gender === 'f' ? 'f' : 'm';
  const canonical = looks[gender];
  if (appearance.outfit === canonical) return false;

  appearance.outfit = canonical;
  character.unlockedOutfits ??= [];
  if (!character.unlockedOutfits.includes(canonical)) {
    character.unlockedOutfits.push(canonical);
  }
  return true;
}

function repairSession(raw: string | null): { value: string | null; changed: boolean } {
  if (!raw) return { value: raw, changed: false };
  try {
    const session = JSON.parse(raw) as HuntSession;
    const changed = repairAutomaticAppearance(session.character);
    return { value: changed ? JSON.stringify(session) : raw, changed };
  } catch {
    return { value: raw, changed: false };
  }
}

function repairState(raw: string): { value: string; changed: boolean } {
  try {
    const character = JSON.parse(raw) as CharacterState;
    const changed = repairAutomaticAppearance(character);
    return { value: changed ? JSON.stringify(character) : raw, changed };
  } catch {
    return { value: raw, changed: false };
  }
}

/**
 * Repairs legacy automatic class sprites once at startup and also intercepts
 * character creation so gender/class defaults are correct before the row is
 * first persisted. Manual outfit changes after creation are never overridden.
 */
export function installVocationAppearanceDefaults(db: Database): void {
  for (const row of db.allCharacters()) {
    const state = repairState(row.state);
    const session = repairSession(row.session);
    if (!state.changed && !session.changed) continue;
    db.saveCharacter(row.id, state.value, session.value, row.settledAt);
  }

  const createCharacter = db.createCharacter.bind(db);
  db.createCharacter = ((accountId: number, name: string, vocationId: number, state: string) => {
    const repaired = repairState(state);
    return createCharacter(accountId, name, vocationId, repaired.value);
  }) as Database['createCharacter'];
}
