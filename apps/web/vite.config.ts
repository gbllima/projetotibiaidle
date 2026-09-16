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
const homeDir = path.join(repoRoot, 'home');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const DEV_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "media-src 'self' blob: https://opengameart.org",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss:",
].join('; ');

const PREVIEW_CSP = DEV_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'");

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

function resolveServedFile(root: string, requestUrl: string, prefix: string): string | null {
  const encoded = requestUrl.slice(prefix.length).split('?')[0] ?? '';
  let relativePath = encoded;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const decoded = decodeURIComponent(relativePath);
      if (decoded === relativePath) break;
      relativePath = decoded;
    } catch {
      return null;
    }
  }
  if (relativePath.includes('\u0000')) return null;

  const file = path.resolve(root, relativePath);
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return file;
}

function serveExtractedAssets(): Plugin {
  return {
    name: 'serve-extracted-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/assets/')) return next();
        const file = resolveServedFile(assetsDir, req.url, '/assets/');
        if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('cache-control', path.extname(file) === '.json' ? 'no-cache, must-revalidate' : 'public, max-age=120');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

function serveHomeAssets(): Plugin {
  return {
    name: 'serve-home-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/home/')) return next();
        const file = resolveServedFile(homeDir, req.url, '/home/');
        if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    },
    buildStart() {
      if (!fs.existsSync(homeDir)) return;
      for (const name of fs.readdirSync(homeDir)) {
        const file = path.join(homeDir, name);
        if (!fs.statSync(file).isFile()) continue;
        const ext = path.extname(name).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) continue;
        this.emitFile({ type: 'asset', fileName: `home/${name}`, source: fs.readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), serveExtractedAssets(), serveHomeAssets()],
  esbuild: {
    legalComments: 'none',
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    headers: {
      ...SECURITY_HEADERS,
      'Content-Security-Policy': DEV_CSP,
    },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  preview: {
    allowedHosts: ['.trycloudflare.com'],
    headers: {
      ...SECURITY_HEADERS,
      'Content-Security-Policy': PREVIEW_CSP,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/e-[hash].js',
        chunkFileNames: 'assets/c-[hash].js',
        assetFileNames: 'assets/a-[hash][extname]',
        manualChunks: {
          pixi: ['pixi.js'],
          data: [path.resolve(repoRoot, 'packages/data/src/index.ts')],
        },
      },
    },
  },
});
