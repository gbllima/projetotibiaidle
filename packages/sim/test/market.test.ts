import { describe, expect, it } from 'vitest';
import { itemsByName } from '@tibia-idle/data';
import { flattenMarketWares, isMarketItem, MARKET_CATALOG, marketBuyPrice } from '../src/market.js';

describe('market catalog', () => {
  it('resolves every listed item with an NPC buy price', () => {
    const missing: string[] = [];
    const noPrice: string[] = [];
    for (const name of flattenMarketWares()) {
      const item = itemsByName.get(name);
      if (!item) missing.push(name);
      else if (marketBuyPrice(item) === null) noPrice.push(name);
    }
    expect(missing, `missing items: ${missing.join(', ')}`).toEqual([]);
    expect(noPrice, `no buy price: ${noPrice.join(', ')}`).toEqual([]);
  });

  it('has at least potions, runes and low armor', () => {
    const ids = new Set(MARKET_CATALOG.map((category) => category.id));
    expect(ids.has('potions')).toBe(true);
    expect(ids.has('runes')).toBe(true);
    expect(ids.has('armor')).toBe(true);
    expect(flattenMarketWares().length).toBeGreaterThan(80);
  });

  it('matches items case-insensitively', () => {
    expect(isMarketItem('Health Potion')).toBe(true);
    expect(isMarketItem('not a real item')).toBe(false);
  });
});
