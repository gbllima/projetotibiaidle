/**
 * Generates boss-encounters.json from monsters.json.
 *
 * Categories (game UI, not Bosstiary race):
 * - boss: lever / quest room bosses with ~20h cooldown (most of Bosstiary)
 * - raid: world-spawn or announced raid bosses (demons, Morshabaal, etc.)
 * - event: seasonal or special-event bosses
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const monsters = JSON.parse(readFileSync(join(root, 'generated/monsters.json'), 'utf8'));

/** Bosstiary-tracked bosses only. */
const BOSSTIARY = new Set(['bane', 'archfoe', 'nemesis']);

/** Mechanics, phases, duplicates — not standalone fights. */
const EXCLUDE_ID = new RegExp(
  [
    '^tentacle',
    '^reflection of ',
    '^charging outburst$',
    '^aftershock$',
    '^foreshock$',
    '^supercharged ',
    '^an? (astral glyph|observer eye|shielded astral)',
    '^adventurer group$',
    '^essence of ',
    '^brother (chill|freeze)$',
    '^weakened demon$',
    '^the hungry baron',
    '^the (destruction|rage|hunger)$',
    "^goshnar's megalomania (blue|purple)$",
    '^ascending ferumbras$',
    '^destabilized ferumbras$',
    '^wildness of urmahlullu$',
    '^wisdom of urmahlullu$',
    '^urmahlullu the tamed$',
    '^ice horror$',
    '^dragon hoard$',
    '^bone overlord$',
    '^ravenous hunger$',
    '^the sandking$',
    '^doctor marrow$',
    '^the primal menace$',
    '^fiona firstdream$',
    '^nigel neverguess$',
    '^percy peacetinker$',
    '^yorik youngbook$',
    '^grendel greenlunch$',
    '^the armored voidborn$',
    '^tropical desolator$',
    '^weakened arbaziloth$',
    '^eradicator2$',
    '^the devourer of secrets$',
    '^the spellstealer$',
    '^the scion of havoc$',
    '^the remorseless corruptor$',
    '^the corruptor of souls$',
    '^concentrated death$',
    '^dark knowledge$',
    '^biting cold$',
    '^the distorted astral source$',
    '^the astral source$',
    '^solid frozen horror$',
    '^the freezing time guardian$',
    '^charged (anomaly|disruption)$',
    '^overcharged disruption$',
    '^damage resonance$',
    '^greed$',
    '^ancient lion knight$',
  ].join('|'),
  'i',
);

/** Explicit entries missing bosstiaryRace in datagen but are real fights. */
const FORCE_INCLUDE = new Set([
  'ferumbras mortal shell',
  'chayenne',
  'minishabaal',
  'the old widow',
  'leviathan',
  'demodras',
  'the first dragon',
  'koshei the deathless',
  'necropharus',
  'the horned fox',
  'general murius',
  'the snapper',
  'stonecracker',
  'thul',
  'the bloodweb',
  'tiquandas revenge',
  'the evil eye',
  'grorlam',
  'dharalion',
  'yaga the crone',
  'barbaria',
  'horestis', // also in raid set
  'the pale count', // nemesis but verify included
]);

/** Force UI category when auto-detect is wrong. */
const CATEGORY_OVERRIDE = {
  'ferumbras mortal shell': 'boss',
  chayenne: 'event',
  minishabaal: 'event',
  'the frog prince': 'event',
  'the old widow': 'boss',
  'world devourer': 'boss',
  leviathan: 'raid',
  apocalypse: 'raid',
  bazir: 'raid',
  infernatil: 'raid',
  verminor: 'raid',
  freegoiz: 'raid',
};
const RAID_IDS = new Set([
  'ferumbras',
  'ghazbaran',
  'morgaroth',
  'orshabaal',
  'morshabaal',
  "gaz'haragoth",
  'omrafir',
  'big boss trolliver',
  'furyosa',
  'zulazza the corruptor',
  'the welter',
  'the imperor',
  'massacre',
  'feroxa',
  'countess sorrow',
  'the handmaiden',
  'the plasmother',
  'dracola',
  'leviathan',
  'horestis',
  'arachir the ancient one',
  'chizzoron the distorter',
  'zushuka',
  'dreadmaw',
  'the abomination',
  'apocalypse',
  'bazir',
  'infernatil',
  'verminor',
  'freegoiz',
]);

/** Seasonal / promotional event bosses. */
const EVENT_IDS = new Set([
  'the percht queen',
  'the mutated pumpkin',
  'fleabringer',
  'the frog prince',
  'minishabaal',
  'chayenne',
]);

/** Quest / area hints for location field. */
const LOCATION_BY_ID = {
  "goshnar's malice": 'Soul War',
  "goshnar's hatred": 'Soul War',
  "goshnar's spite": 'Soul War',
  "goshnar's cruelty": 'Soul War',
  "goshnar's greed": 'Soul War',
  "goshnar's megalomania green": 'Soul War',
  'ferumbras mortal shell': 'Ferumbras Ascendant',
  chayenne: 'Store Event',
  minishabaal: 'Halloween',
  'the old widow': 'Plains of Havoc',
  leviathan: 'Svargrond',
  demodras: 'Darashia',
  'the first dragon': 'Forgotten Knowledge',
  'the frog prince': 'Thais',
  razzagorn: 'Ferumbras Ascendant',
  ragiaz: 'Ferumbras Ascendant',
  zamulosh: 'Ferumbras Ascendant',
  mazoran: 'Ferumbras Ascendant',
  plagirath: 'Ferumbras Ascendant',
  shulgrax: 'Ferumbras Ascendant',
  tarbaz: 'Ferumbras Ascendant',
  lloyd: 'Forgotten Knowledge',
  'the enraged thorn knight': 'Forgotten Knowledge',
  'the last lore keeper': 'Forgotten Knowledge',
  'lady tenebris': 'Forgotten Knowledge',
  'the time guardian': 'Forgotten Knowledge',
  'the blazing time guardian': 'Forgotten Knowledge',
  'the diamond blossom': 'Forgotten Knowledge',
  'the lily of night': 'Forgotten Knowledge',
  'melting frozen horror': 'Forgotten Knowledge',
  anomaly: 'Heart of Destruction',
  outburst: 'Heart of Destruction',
  eradicator: 'Heart of Destruction',
  rupture: 'Heart of Destruction',
  realityquake: 'Heart of Destruction',
  'the souldespoiler': 'Heart of Destruction',
  ghulosh: 'Secret Library',
  mazzinor: 'Secret Library',
  lokathmor: 'Secret Library',
  gorzindel: 'Secret Library',
  'the scourge of oblivion': 'Secret Library',
  'duke krule': 'Grave Danger',
  'count vlarkorth': 'Grave Danger',
  'lord azaram': 'Grave Danger',
  'king zelos': 'Grave Danger',
  'sir nictros': 'Grave Danger',
  'sir baeloc': 'Grave Danger',
  'earl osam': 'Grave Danger',
  'the dread maiden': 'Feaster of Souls',
  'the fear feaster': 'Feaster of Souls',
  'the pale worm': 'Feaster of Souls',
  'the unwelcome': 'Feaster of Souls',
  'brain head': 'Feaster of Souls',
  'the nightmare beast': 'Feaster of Souls',
  'magma bubble': 'Primal Ordeal',
  bakragore: 'Rotten Blood',
  murcion: 'Rotten Blood',
  chagorz: 'Rotten Blood',
  ichgahal: 'Rotten Blood',
  vemiath: 'Rotten Blood',
  'grand master oberon': 'Falcon Bastion',
  'grand canon dominus': 'Falcon Bastion',
  'grand chaplain gaunder': 'Falcon Bastion',
  'grand commander soeren': 'Falcon Bastion',
  'preceptor lazare': 'Falcon Bastion',
  'faceless bane': 'Bounac',
  'scarlett etzel': 'Bounac',
  drume: 'Bounac',
  'megasylvan yselda': 'Bounac',
  'timira the many-headed': 'Marapur',
  'unaz the mean': 'Issavi',
  'amenef the burning': 'Issavi',
  'sister hetai': 'Issavi',
  'neferi the spy': 'Issavi',
  'the brainstealer': 'Podzilla',
  'the monster': 'Ingol',
  'the pale count': 'Drefia',
  'the baron from below': 'Warzone',
  'the count of the core': 'Warzone',
  'the duke of the depths': 'Warzone',
  'the lord of the lice': 'Warzone',
  'death priest shargon': 'Dark Cathedral',
  boreth: 'Vengoth',
  lersatio: 'Vengoth',
  marziel: 'Vengoth',
  dipthrah: 'Drefia',
  mahrdis: 'Drefia',
  omruc: 'Drefia',
  rahemos: 'Drefia',
  thalas: 'Drefia',
  vashresamun: 'Drefia',
  morguthis: 'Drefia',
  'the ravager': 'Hive',
  alptramun: 'Dream Courts',
  maxxenius: 'Dream Courts',
  'malofur mangrinder': 'Dream Courts',
  plagueroot: 'Dream Courts',
  'izcandar the banished': 'Dream Courts',
  'izcandar champion of summer': 'Dream Courts',
  'izcandar champion of winter': 'Dream Courts',
  'sugar daddy': 'Candia',
  'sugar mommy': 'Candia',
  'urmahlullu the immaculate': 'Kilmaresh',
  'urmahlullu the weakened': 'Kilmaresh',
  ferumbras: 'Ferumbras Tower',
  ghazbaran: 'Edron',
  morgaroth: 'Edron',
  orshabaal: 'Edron',
  'world devourer': 'Heart of Destruction',
  omrafir: 'Roshamuul',
  morshabaal: "Ab'Dendriel",
  "gaz'haragoth": 'Rathleton',
  'the percht queen': 'Winterlight Solstice',
  'the mutated pumpkin': 'Halloween',
  'big boss trolliver': 'Edron',
};

const RACE_LABEL = { bane: 'Bane', archfoe: 'Archfoe', nemesis: 'Nemesis' };

function slug(id) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function suggestMinLevel(monster) {
  const xp = monster.experience || 0;
  const hp = monster.health || 0;
  const score = Math.max(xp / 5000, hp / 2000);
  if (score >= 800) return 500;
  if (score >= 400) return 400;
  if (score >= 200) return 300;
  if (score >= 80) return 250;
  if (score >= 30) return 200;
  if (score >= 10) return 150;
  if (score >= 3) return 100;
  if (score >= 1) return 50;
  return 20;
}

function categorize(id) {
  if (CATEGORY_OVERRIDE[id]) return CATEGORY_OVERRIDE[id];
  if (EVENT_IDS.has(id)) return 'event';
  if (RAID_IDS.has(id)) return 'raid';
  return 'boss';
}

function locationFor(id) {
  return LOCATION_BY_ID[id] ?? 'Tibia';
}

function descriptionFor(monster) {
  const race = RACE_LABEL[monster.bosstiaryRace] ?? 'Boss';
  const loc = locationFor(monster.id);
  const cat = categorize(monster.id);
  if (monster.bosstiaryRace === 'bane') {
    return `${race} em ${loc}. Pode ser morto várias vezes em 20h (Bosstiary).`;
  }
  if (cat === 'raid') {
    return `${race} — raid de mundo em ${loc}. Spawn anunciado ou raro.`;
  }
  if (cat === 'event') {
    return `${race} — evento especial (${loc}).`;
  }
  return `${race} em ${loc}. Boss de alavanca com cooldown de 20 horas.`;
}

const candidates = monsters.filter((m) => {
  if (!m.isBoss) return false;
  if (EXCLUDE_ID.test(m.id)) return false;
  if (m.health < 50) return false;
  if (BOSSTIARY.has(m.bosstiaryRace)) return true;
  if (FORCE_INCLUDE.has(m.id)) return true;
  return false;
});

candidates.sort((a, b) => a.name.localeCompare(b.name));

const seenSlugs = new Set();
const entries = [];

for (const monster of candidates) {
  let id = slug(monster.id);
  if (seenSlugs.has(id)) {
    id = `${id}-${monster.bosstiaryRace}`;
  }
  seenSlugs.add(id);

  entries.push({
    id,
    monsterId: monster.id,
    category: categorize(monster.id),
    location: locationFor(monster.id),
    minLevel: suggestMinLevel(monster),
    description: descriptionFor(monster),
  });
}

const counts = { boss: 0, raid: 0, event: 0 };
for (const entry of entries) counts[entry.category] += 1;

const outPath = join(root, 'generated/boss-encounters.json');
writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`);

console.log(`Wrote ${entries.length} boss encounters → ${outPath}`);
console.log('Categories:', counts);
