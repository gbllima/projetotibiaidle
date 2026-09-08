import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const apiTarget = process.env['API_URL'] ?? 'http://127.0.0.1:3000';
const assetsDir = path.join(repoRoot, 'tools', 'extractor', 'out', 'assets');

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
};

/** Serve extractor output from disk so the scene works even if the API is down. */
function serveExtractedAssets(): Plugin {
  return {
    name: 'serve-extracted-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/assets/')) return next();
        const rel = decodeURIComponent(req.url.slice('/assets/'.length).split('?')[0] ?? '');
        const file = path.normalize(path.join(assetsDir, rel));
        if (!file.startsWith(assetsDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
        // JSON must not stick for a day — regenerated atlases left hunts black.
        res.setHeader(
          'cache-control',
          path.extname(file) === '.json' ? 'no-cache, must-revalidate' : 'public, max-age=120',
        );
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveExtractedAssets()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          data: [path.resolve(repoRoot, 'packages/data/src/index.ts')],
        },
      },
    },
  },
});
