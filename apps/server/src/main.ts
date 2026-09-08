import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';

const { app } = await createApp({
  databaseFile: process.env['DATABASE_FILE'] ?? path.join(repoRoot, 'data', 'tibia-idle.db'),
  assetsDir: process.env['ASSETS_DIR'] ?? path.join(repoRoot, 'tools', 'extractor', 'out', 'assets'),
  webDir: process.env['WEB_DIR'] ?? path.join(repoRoot, 'apps', 'web', 'dist'),
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
