import { afterEach, describe, expect, it } from 'vitest';
import { TICK_MS } from '@tibia-idle/sim';
import { runLoad } from '../src/loadtest.js';
import { setHuntCap } from '../src/queue.js';

afterEach(() => {
  setHuntCap(8);
});

describe('load', () => {
  it('settles many hunters in one pass without multiplying ticks', async () => {
    const hunters = 12;
    const minutes = 6;
    const report = await runLoad({ hunters, minutes });
    const expected = hunters * Math.floor((minutes * 60 * 1000) / TICK_MS);

    expect(report.ticks).toBeGreaterThanOrEqual(expected);
    expect(report.ticks).toBeLessThan(expected + hunters * 40);
    expect(report.kills).toBeGreaterThan(hunters);
    expect(report.settleMs).toBeLessThan(8_000);
  }, 30_000);
});
