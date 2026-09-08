import fs from 'node:fs';
import sax from 'sax';
import { PATHS } from './paths.js';

/**
 * items.xml is ~3.7 MB / 87k lines, so it is parsed as a stream rather than
 * built into a DOM.
 *
 * Note the schema quirk: this server has no `stackable` attribute. Stacking is
 * engine behaviour, so we take it from the client's appearance flags instead
 * (see `mergeAppearanceFlags`).
 */

export interface Item {
  id: number;
  name: string;
  article: string | null;
  plural: string | null;
  description: string | null;
  /** e.g. "sword weapons", "armors", "attack runes" */
  type: string | null;
  weaponType: string | null;
  /** Crystal 15.12 basic melee swing (sword, club, axe, fist, monkstaff, monkdaggers). */
  meleeAttackEffect: string | null;
  slot: string | null;
  attack: number;
  defense: number;
  extraDefense: number;
  armor: number;
  /** hundredths of an oz, as stored */
  weight: number;
  charges: number | null;
  runeSpellName: string | null;
  /** Skill and stat bonuses, keyed by the raw attribute name. */
  bonuses: Record<string, number>;
  imbuementSlots: number;
  /** Level required to equip, 0 when unrestricted. */
  levelRequired: number;
  /** Vocations that may equip it. Empty means all. */
  vocations: string[];
  range: number;
  hitChance: number | null;
  ammoType: string | null;
  shootType: string | null;
  containerSize: number | null;
  duration: number | null;
  stackable: boolean;
  marketCategory: number | null;
  hasSprite: boolean;
  /** Appearance id the client draws, which is not always the server id. */
  clientId: number | null;
  /** Best NPC sell price, from tools/datagen/src/prices.ts. */
  sellPrice: number | null;
  buyPrice: number | null;
}

const NUMERIC_BONUS_KEYS = new Set([
  'skillsword', 'skillaxe', 'skillclub', 'skilldist', 'skillfist', 'skillshield',
  'magiclevelpoints', 'criticalhitchance', 'criticalhitdamage',
  'lifeleechchance', 'lifeleechamount', 'manaleechchance', 'manaleechamount',
  'healthgain', 'healthticks', 'managain', 'manaticks', 'speed',
  'absorbpercentphysical', 'absorbpercentfire', 'absorbpercentice',
  'absorbpercentearth', 'absorbpercentenergy', 'absorbpercentholy',
  'absorbpercentdeath', 'absorbpercentall',
  'elementfire', 'elementice', 'elementearth', 'elementenergy',
  'elementholy', 'elementdeath',
]);

const toInt = (v: string | undefined): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

export async function parseItems(): Promise<Item[]> {
  const parser = sax.createStream(false, { lowercase: true, trim: true });
  const items: Item[] = [];

  let current: Item | null = null;
  let depth = 0;

  parser.on('opentag', (node) => {
    const attrs = node.attributes as Record<string, string>;

    if (node.name === 'item') {
      depth = 0;
      const id = toInt(attrs['id']);
      // Range entries (fromid/toid) are map decoration variants; skip them.
      if (!id || !attrs['name']) {
        current = null;
        return;
      }
      current = {
        id,
        name: attrs['name'],
        article: attrs['article'] ?? null,
        plural: attrs['plural'] ?? null,
        description: null,
        type: null,
        weaponType: null,
        meleeAttackEffect: null,
        slot: null,
        attack: 0,
        defense: 0,
        extraDefense: 0,
        armor: 0,
        weight: 0,
        charges: null,
        runeSpellName: null,
        bonuses: {},
        imbuementSlots: 0,
        levelRequired: 0,
        vocations: [],
        range: 0,
        hitChance: null,
        ammoType: null,
        shootType: null,
        containerSize: null,
        duration: null,
        stackable: false,
        marketCategory: null,
        hasSprite: false,
        clientId: null,
        sellPrice: null,
        buyPrice: null,
      };
      return;
    }

    if (node.name !== 'attribute' || !current) return;
    depth += 1;
    const key = (attrs['key'] ?? '').toLowerCase();
    const value = attrs['value'] ?? '';

    // Nested under moveevent / imbuementslot. Level, slot and vocation live in
    // script blocks; imbuement children use different keys (life leech, etc.).
    if (depth > 1 && !['vocation', 'level', 'slot', 'slottype'].includes(key)) return;

    switch (key) {
      case 'primarytype': current.type = value; break;
      case 'weapontype': current.weaponType = value; break;
      case 'meleeattackeffect': current.meleeAttackEffect = value; break;
      case 'slot': case 'slottype': current.slot = value; break;
      case 'attack': current.attack = toInt(value); break;
      case 'defense': current.defense = toInt(value); break;
      case 'extradef': current.extraDefense = toInt(value); break;
      case 'armor': current.armor = toInt(value); break;
      case 'weight': current.weight = toInt(value); break;
      case 'charges': current.charges = toInt(value); break;
      case 'runespellname': current.runeSpellName = value; break;
      case 'imbuementslot': current.imbuementSlots = toInt(value); break;
      case 'level': current.levelRequired = Math.max(current.levelRequired, toInt(value)); break;
      case 'range': current.range = toInt(value); break;
      case 'description': current.description = value; break;
      case 'hitchance': current.hitChance = toInt(value); break;
      case 'ammotype': current.ammoType = value; break;
      case 'shoottype': current.shootType = value; break;
      case 'containersize': current.containerSize = toInt(value); break;
      case 'duration': current.duration = toInt(value); break;
      // "Knight;true, Elite Knight" is a vocation, a show-in-description flag
      // and the promoted vocation name, all in one string.
      case 'vocation': {
        const parts = value
          .split(/[;,]/)
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v && v !== 'true' && v !== 'false');
        current.vocations = [...new Set([...current.vocations, ...parts])];
        break;
      }
      default:
        if (NUMERIC_BONUS_KEYS.has(key)) current.bonuses[key] = toInt(value);
    }
  });

  parser.on('closetag', (name) => {
    if (name === 'attribute') { depth = Math.max(0, depth - 1); return; }
    if (name === 'item' && current) {
      items.push(current);
      current = null;
    }
  });

  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(PATHS.itemsXml, 'utf8').pipe(parser);
  });

  return items;
}

/** Fill in stackable / market flags from the extracted client metadata. */
export function mergeAppearanceFlags(
  items: Item[],
  appearance: Record<string, { name?: string; stackable?: boolean; marketCategory?: number }>,
): { withSprite: number; stackable: number; byName: number } {
  const byUniqueName = new Map<string, string>();
  const byAnyName = new Map<string, string[]>();
  const ambiguous = new Set<string>();
  for (const [id, entry] of Object.entries(appearance)) {
    const name = entry.name?.toLowerCase();
    if (!name) continue;
    const list = byAnyName.get(name) ?? [];
    list.push(id);
    byAnyName.set(name, list);
    if (byUniqueName.has(name)) ambiguous.add(name);
    else byUniqueName.set(name, id);
  }
  for (const name of ambiguous) byUniqueName.delete(name);

  let withSprite = 0;
  let stackable = 0;
  let byName = 0;

  const apply = (item: Item, key: string, matchedByName: boolean) => {
    const entry = appearance[key];
    if (!entry) return;
    item.hasSprite = true;
    item.clientId = Number(key);
    withSprite += 1;
    if (matchedByName) byName += 1;
    if (entry.stackable) { item.stackable = true; stackable += 1; }
    if (typeof entry.marketCategory === 'number') item.marketCategory = entry.marketCategory;
  };

  for (const item of items) {
    const direct = appearance[String(item.id)];
    if (direct) {
      apply(item, String(item.id), false);
      continue;
    }
    const unique = byUniqueName.get(item.name.toLowerCase());
    if (unique) {
      apply(item, unique, true);
      continue;
    }
    const candidates = byAnyName.get(item.name.toLowerCase());
    if (!candidates?.length) continue;
    const sameId = candidates.find((id) => Number(id) === item.id);
    apply(item, sameId ?? candidates[0]!, true);
  }

  const clientByName = new Map<string, number>();
  const score = (row: Item) => (row.buyPrice !== null ? 4 : 0) + (row.sellPrice !== null ? 2 : 0);
  for (const item of items) {
    if (item.clientId == null) continue;
    const key = item.name.toLowerCase();
    const prevId = clientByName.get(key);
    if (prevId === undefined) {
      clientByName.set(key, item.clientId);
      continue;
    }
    const prev = items.find((row) => row.clientId === prevId);
    if (prev && score(item) > score(prev)) clientByName.set(key, item.clientId);
  }
  for (const item of items) {
    if (item.clientId != null) continue;
    const clientId = clientByName.get(item.name.toLowerCase());
    if (clientId == null) continue;
    item.clientId = clientId;
    item.hasSprite = true;
    withSprite += 1;
  }

  return { withSprite, stackable, byName };
}
