import fs from 'node:fs';

const xml = fs.readFileSync('servidor/data/items/items.xml', 'utf8');
const items = [];
const re = /<item id="(\d+)"[^>]*name="([^"]+)"[\s\S]*?<\/item>/g;
let match;
while ((match = re.exec(xml))) {
  const block = match[0];
  if (!/key="weaponType" value="wand"/i.test(block)) continue;
  if (!/key="fromDamage"/i.test(block) && !/key="shootType"/i.test(block)) continue;
  const attr = (key) => {
    const hit = block.match(new RegExp(`key="${key}" value="([^"]+)"`, 'i'));
    return hit ? hit[1] : null;
  };
  items.push({
    id: Number(match[1]),
    name: match[2],
    shootType: attr('shootType'),
    wandType: attr('wandType'),
    fromDamage: Number(attr('fromDamage') ?? 0),
    toDamage: Number(attr('toDamage') ?? 0),
    mana: Number(attr('mana') ?? 0),
    levelRequired: Number(attr('level') ?? 0),
  });
}
items.sort((a, b) => a.id - b.id);
fs.writeFileSync('packages/data/generated/wands.json', JSON.stringify(items));
console.log('wands', items.length);
console.log('vortex', items.find((item) => item.id === 3074));
console.log('snakebite', items.find((item) => item.id === 3066));
