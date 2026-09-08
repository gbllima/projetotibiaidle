import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { Database } from './db.js';
import { loadWorldEvent } from './admin.js';
import { reconcileHunts } from './game.js';
import { registerRoutes } from './routes.js';
import { registerWebSocket } from './ws.js';

export interface AppOptions {
  databaseFile: string;
  /** Directory of extracted sprite atlases, served to the browser. */
  assetsDir?: string;
  /** Built web client, served in production. */
  webDir?: string;
  logger?: boolean;
}

export async function createApp(options: AppOptions): Promise<{ app: FastifyInstance; db: Database }> {
  const db = new Database(options.databaseFile);
  loadWorldEvent(db);
  // Drop ghost hunters left behind by restarts / abandoned test characters.
  reconcileHunts(db);
  const reconcileTimer = setInterval(() => {
    try {
      reconcileHunts(db);
    } catch (error) {
      console.error('hunt reconcile timer', error);
    }
  }, 5 * 60_000);
  reconcileTimer.unref?.();

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerRoutes(app, db);
  registerWebSocket(app, db);

  app.addHook('onClose', async () => {
    clearInterval(reconcileTimer);
  });

  // Atlases are large and immutable once generated, so they get a long cache
  // lifetime; their filenames change when the extractor reruns.
  if (options.assetsDir && fs.existsSync(options.assetsDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(options.assetsDir),
      prefix: '/assets/',
      cacheControl: true,
      maxAge: '30d',
      decorateReply: false,
    });
  }

  if (options.webDir && fs.existsSync(options.webDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(options.webDir),
      prefix: '/',
      decorateReply: false,
    });
    // Client-side routing: anything not matched above returns the shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.status(404).send({ error: 'Not found.' });
      }
      return reply.type('text/html').send(fs.readFileSync(path.join(options.webDir!, 'index.html')));
    });
  }

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, db };
}
