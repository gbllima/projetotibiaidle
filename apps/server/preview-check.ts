import { createApp } from './src/app.js';
import { createCharacter, deriveStats, expForLevel } from '@tibia-idle/sim';
import { issueToken } from './src/auth.js';
import fs from 'node:fs';
import path from 'node:path';
const { app, db } = await createApp({ databaseFile: ':memory:', assetsDir: path.resolve('tools/extractor/out/assets') });
const account = db.createAccount('gbllima', 'preview', 'preview');
const token = issueToken(db, account.id, account.username).token;
const ids: number[] = [];
for (const [name, vocation, level] of [['Krauxz', 2, 51], ['Krauxz Paladin', 3, 49], ['New Knight', 4, 8]] as const) {
  const character = createCharacter(name, vocation);
  character.level = level; character.experience = expForLevel(level); character.gold = 250_000; character.coins = 800; character.partySlots = 2; character.stamina = 2000;
  character.equipment = { head: 3351, armor: 3357, legs: 3372, feet: 3552, left: 3271, backpack: 2854 };
  character.backpackContents = [{ itemId: 3271, count: 1 }];
  const stats = deriveStats(character); character.health = stats.maxHealth; character.mana = stats.maxMana;
  ids.push(db.createCharacter(account.id, name, vocation, JSON.stringify(character)).id);
}
db.setWorld('party:' + ids[0], JSON.stringify(ids.slice(0, 2)));
fs.writeFileSync(path.join(process.env.TEMP!, 'idle-party-browser-check', 'fixture.json'), JSON.stringify({ token, ids }));
await app.listen({ port: 3018, host: '127.0.0.1' });
console.log('Isolated preview ready on 3018');
