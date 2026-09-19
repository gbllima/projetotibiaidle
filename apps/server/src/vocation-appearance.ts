import { STARTER_VOCATION_APPEARANCE } from '@tibia-idle/data';
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

/** Old automatic looks that were assigned before the vocation mapping fix. */
const LEGACY_AUTOMATIC_LOOK: Record<number, number[]> = {
  1: [130, 138],
  2: [144, 148],
  3: [129, 137],
  4: [131, 139],
  9: [128, 146, 150, 1824, 1825],
};

const LEGACY_AUTOMATIC_COLORS = { head: 78, body: 94, legs: 114, feet: 115 };

function hasLegacyAutomaticColors(character: CharacterState): boolean {
  const appearance = character.appearance;
  if (!appearance) return false;
  return appearance.head === LEGACY_AUTOMATIC_COLORS.head
    && appearance.body === LEGACY_AUTOMATIC_COLORS.body
    && appearance.legs === LEGACY_AUTOMATIC_COLORS.legs
    && appearance.feet === LEGACY_AUTOMATIC_COLORS.feet;
}


function repairAutomaticAppearance(character: CharacterState): boolean {
  const base = BASE_VOCATION[character.vocationId] ?? character.vocationId;
  const canonical = STARTER_VOCATION_APPEARANCE[base];
  const legacyLooks = LEGACY_AUTOMATIC_LOOK[base];
  const appearance = character.appearance;
  if (!canonical || !legacyLooks || !appearance) return false;

  // Only migrate starter looks that still carry the old automatic colors.
  // Purchased/customized appearances are deliberately left untouched.
  if (!legacyLooks.includes(appearance.outfit) || !hasLegacyAutomaticColors(character)) return false;

  const gender = character.gender === 'f' ? 'f' : 'm';
  const targetOutfit = gender === 'f' ? canonical.female : canonical.male;
  const next = {
    outfit: targetOutfit,
    ...canonical.colors,
  };

  const changed = appearance.outfit !== next.outfit
    || appearance.head !== next.head
    || appearance.body !== next.body
    || appearance.legs !== next.legs
    || appearance.feet !== next.feet;
  if (!changed) return false;

  appearance.outfit = next.outfit;
  appearance.head = next.head;
  appearance.body = next.body;
  appearance.legs = next.legs;
  appearance.feet = next.feet;
  character.unlockedOutfits ??= [];
  if (!character.unlockedOutfits.includes(targetOutfit)) {
    character.unlockedOutfits.push(targetOutfit);
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
