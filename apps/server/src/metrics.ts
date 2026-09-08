import type { CharacterState } from '@tibia-idle/sim';
import type { Database } from './db.js';

export function track(
  db: Database,
  name: string,
  fields: { accountId?: number; characterId?: number; value?: number; extra?: string } = {},
): void {
  try {
    db.track(name, fields);
  } catch {
    // Metrics must never break a player action.
  }
}

export function isBetaOpen(db: Database): boolean {
  return db.getWorld('beta') !== 'closed';
}

export function metricsSnapshot(db: Database, now = Date.now()) {
  const day = now - 24 * 60 * 60 * 1000;
  const rows = db.allCharacters();
  let gold = 0;
  let coins = 0;
  let hunting = 0;
  for (const row of rows) {
    const state = JSON.parse(row.state) as CharacterState;
    gold += state.gold ?? 0;
    coins += state.coins ?? 0;
    if (row.session) hunting += 1;
  }

  const events = db.telemetrySince(day);
  const byName = Object.fromEntries(events.map((entry) => [entry.name, { count: Number(entry.n), value: Number(entry.value) }]));
  const huntStop = byName['hunt_stop'] ?? { count: 0, value: 0 };
  const daily = byName['act:daily'] ?? { count: 0, value: 0 };
  const convert = byName['act:convert'] ?? { count: 0, value: 0 };
  const shop = byName['act:shop'] ?? { count: 0, value: 0 };

  const cohort = db.accountsCreatedBetween(now - 48 * 60 * 60 * 1000, day);
  const returned = db.accountsActiveSince(cohort, day);

  const queued = Object.values(db.queueByHunt()).reduce((sum, n) => sum + n, 0);

  return {
    accounts: db.countAccounts(),
    characters: rows.length,
    hunting,
    queued,
    gold,
    coins,
    last24h: {
      dau: db.distinctAccountsSince(day),
      registers: byName['register']?.count ?? 0,
      huntsStarted: byName['hunt_start']?.count ?? 0,
      huntsStopped: huntStop.count,
      goldFromHunts: huntStop.value,
      goldFromDaily: daily.value,
      goldConverted: convert.value,
      shopPurchases: shop.count,
    },
    topHunts: db.topHuntStarts(day),
    retention: {
      d1Cohort: cohort.length,
      d1Returned: returned,
      d1: cohort.length ? Math.round((returned / cohort.length) * 100) : null,
    },
    events: byName,
    beta: isBetaOpen(db) ? 'open' : 'closed',
  };
}
