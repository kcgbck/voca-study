// scripts/moonshineAssets.ts
// Vite plugin to serve and bundle Moonshine v2 runtime assets from @moonshine-ai/moonshine-wasm

import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export const MOONSHINE_ALLOWLIST = [
  'transcriber.js',
  'module.js',
  'errors.js',
  'asset-downloader.js',
  'enums.js',
  'stream.js',
  'events.js',
  'types.js',
  'moonshine.mjs',
  'moonshine.wasm',
] as const;

export const MOONSHINE_URL_PREFIX = '/moonshine/0.1.5/';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function moonshineAssetsPlugin(): Plugin {
  let distDir: string | null = null;

  function resolveSdkDist(root: string): string {
    const candidate = path.resolve(root, 'node_modules/@moonshine-ai/moonshine-wasm/dist');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Fallback for monorepo / alternative resolution
    return path.resolve(process.cwd(), 'node_modules/@moonshine-ai/moonshine-wasm/dist');
  }

  return {
    name: 'vite-plugin-moonshine-assets',

    configResolved(config) {
      distDir = resolveSdkDist(config.root);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url || !url.startsWith(MOONSHINE_URL_PREFIX)) {
          return next();
        }

        // Prevent directory traversal
        const fileName = url.slice(MOONSHINE_URL_PREFIX.length);
        if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        if (!MOONSHINE_ALLOWLIST.includes(fileName as any)) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const sourcePath = path.join(distDir || resolveSdkDist(process.cwd()), fileName);
        if (!fs.existsSync(sourcePath)) {
          res.statusCode = 404;
          res.end(`Asset not found: ${fileName}`);
          return;
        }

        const ext = path.extname(fileName);
        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

        const stream = fs.createReadStream(sourcePath);
        stream.pipe(res);
      });
    },

    generateBundle() {
      const sourceDir = distDir || resolveSdkDist(process.cwd());
      for (const fileName of MOONSHINE_ALLOWLIST) {
        const filePath = path.join(sourceDir, fileName);
        if (!fs.existsSync(filePath)) {
          throw new Error(
            `Required Moonshine SDK runtime asset missing at '${filePath}'. Check that @moonshine-ai/moonshine-wasm is properly installed.`
          );
        }
        const content = fs.readFileSync(filePath);
        this.emitFile({
          type: 'asset',
          fileName: `moonshine/0.1.5/${fileName}`,
          source: content,
        });
      }
    },
  };
}
