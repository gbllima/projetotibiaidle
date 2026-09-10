import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { meta } from '@tibia-idle/data';
import { Database } from './db.js';
import { loadWorldEvent } from './admin.js';
import { reconcileHunts } from './game.js';
import { registerRoutes } from './routes.js';
import { registerPartyItemRoutes, sweepIgnoredLoot } from './party-items.js';
import { registerWebSocket } from './ws.js';

export interface AppOptions {
  databaseFile: string;
  assetsDir?: string;
  webDir?: string;
  logger?: boolean;
}

export async function createApp(options: AppOptions): Promise<{ app: FastifyInstance; db: Database }> {
  const db = new Database(options.databaseFile);
  loadWorldEvent(db);
  reconcileHunts(db);
  const reconcileTimer = setInterval(() => {
    try { reconcileHunts(db); } catch (error) { console.error('hunt reconcile timer', error); }
  }, 5 * 60_000);
  reconcileTimer.unref?.();

  // Per-item loot blacklist. The combat simulator still rolls drops normally,
  // then ignored stacks are discarded from the active loot pouch server-side.
  const ignoredLootTimer = setInterval(() => {
    try { sweepIgnoredLoot(db); } catch (error) { console.error('ignored loot sweep', error); }
  }, 1500);
  ignoredLootTimer.unref?.();

  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerRoutes(app, db);
  registerPartyItemRoutes(app, db);

  // Public, read-only server information used by the landing page.
  // No account data, currency balances or private character state is exposed.
  app.get('/api/public-stats', async () => {
    const characters = db.allCharacters();
    let hunting = 0;
    for (const character of characters) if (character.session) hunting += 1;
    return {
      beta: db.getWorld('beta') !== 'closed' ? 'open' : 'closed',
      accounts: db.countAccounts(),
      characters: characters.length,
      hunting,
      monsters: Number(meta.counts['monsters'] ?? 0),
      items: Number(meta.counts['items'] ?? 0),
      vocations: Number(meta.counts['vocations'] ?? 0),
      hunts: Number(meta.counts['hunts'] ?? 0),
      generatedAt: meta.generatedAt,
    };
  });

  registerWebSocket(app, db);

  app.addHook('onClose', async () => {
    clearInterval(reconcileTimer);
    clearInterval(ignoredLootTimer);
  });

  if (options.assetsDir && fs.existsSync(options.assetsDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(options.assetsDir), prefix: '/assets/', cacheControl: true, maxAge: '30d', decorateReply: false,
    });
  }

  if (options.webDir && fs.existsSync(options.webDir)) {
    await app.register(fastifyStatic, { root: path.resolve(options.webDir), prefix: '/', decorateReply: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) return reply.status(404).send({ error: 'Not found.' });
      return reply.type('text/html').send(fs.readFileSync(path.join(options.webDir!, 'index.html')));
    });
  }

  app.addHook('onClose', async () => { db.close(); });
  return { app, db };
}
