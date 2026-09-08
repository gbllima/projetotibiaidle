import { charms } from '@tibia-idle/data';
import { describe, expect, it } from 'vitest';
import { Rng, charmPassive, charmStrike, charmParryReflect, charmCarnageDamage, charmCrippleParalyze, createCharacter, huntMultipliers } from '../src/index.js';

describe('charm effects', () => {
  it('Gut raises loot on the bound species only', () => {
    const gut = charms.find((charm) => charm.name === 'Gut')!;
    const character = createCharacter('Kina', 4);
    character.charmsUnlocked = [gut.id];
    character.charmBinds = [{ charmId: gut.id, monsterId: 'rotworm' }];
    const vsRotworm = huntMultipliers(character, 'rotworm');
    const vsRat = huntMultipliers(character, 'rat');
    expect(vsRotworm.loot).toBeGreaterThan(vsRat.loot);
    expect(charmPassive(character, 'rotworm').loot).toBeGreaterThan(1);
  });

  it('Wound can deal a slice of the creature max HP', () => {
    const wound = charms.find((charm) => charm.name === 'Wound')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: wound.id, monsterId: 'dragon' }];
    let hit = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const strike = charmStrike(character, 'dragon', 1000, new Rng(seed));
      if (strike.damage > 0) hit = strike.damage;
    }
    expect(hit).toBe(50);
  });

  it('Vampiric Embrace can leech on a bound species', () => {
    const vamp = charms.find((charm) => charm.name === 'Vampiric Embrace')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: vamp.id, monsterId: 'rotworm' }];
    let leech = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const strike = charmStrike(character, 'rotworm', 200, new Rng(seed));
      if (strike.leech > 0) leech = strike.leech;
    }
    expect(leech).toBeGreaterThan(0);
  });

  it('Parry can reflect damage back to the attacker species', () => {
    const parry = charms.find((charm) => charm.name === 'Parry')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: parry.id, monsterId: 'rotworm' }];
    let reflected = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const amount = charmParryReflect(character, 'rotworm', 80, new Rng(seed));
      if (amount > 0) reflected = amount;
    }
    expect(reflected).toBe(80);
  });

  it('Carnage can splash when a bound species dies', () => {
    const carnage = charms.find((charm) => charm.name === 'Carnage')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: carnage.id, monsterId: 'rotworm' }];
    let splash = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const amount = charmCarnageDamage(character, 'rotworm', 400, new Rng(seed));
      if (amount > 0) splash = amount;
    }
    expect(splash).toBe(60);
  });

  it('Cripple can paralyze the bound species on hit', () => {
    const cripple = charms.find((charm) => charm.name === 'Cripple')!;
    const character = createCharacter('Kina', 4);
    character.charmBinds = [{ charmId: cripple.id, monsterId: 'rotworm' }];
    let hit = false;
    for (let seed = 1; seed <= 80; seed += 1) {
      if (charmCrippleParalyze(character, 'rotworm', new Rng(seed))) hit = true;
    }
    expect(hit).toBe(true);
  });
});
