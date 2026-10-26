// tests/conversationMoonshineAssets.test.ts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  moonshineAssetsPlugin,
  MOONSHINE_ALLOWLIST,
  MOONSHINE_URL_PREFIX,
} from '../scripts/moonshineAssets';

describe('moonshineAssetsPlugin and runtime assets', () => {
  const sdkDist = path.resolve(process.cwd(), 'node_modules/@moonshine-ai/moonshine-wasm/dist');

  it('contains all 10 approved runtime assets in node_modules dist', () => {
    expect(MOONSHINE_ALLOWLIST).toHaveLength(10);
    expect(MOONSHINE_ALLOWLIST).toEqual([
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
    ]);

    for (const file of MOONSHINE_ALLOWLIST) {
      const filePath = path.join(sdkDist, file);
      expect(fs.existsSync(filePath), `File should exist: ${file}`).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('does not include source maps, d.ts, tts, or cloning assets in allowlist', () => {
    for (const file of MOONSHINE_ALLOWLIST) {
      expect(file.endsWith('.map')).toBe(false);
      expect(file.endsWith('.d.ts')).toBe(false);
      expect(file.toLowerCase().includes('tts')).toBe(false);
      expect(file.toLowerCase().includes('clone')).toBe(false);
    }
  });

  it('serves allowed assets with security headers and blocks path traversal', () => {
    const plugin = moonshineAssetsPlugin() as any;
    plugin.configResolved?.({ root: process.cwd() });

    let middlewareHandler: any = null;
    const mockServer = {
      middlewares: {
        use: vi.fn().mockImplementation((fn) => {
          middlewareHandler = fn;
        }),
      },
    };

    plugin.configureServer?.(mockServer);
    expect(middlewareHandler).not.toBeNull();

    // 1. Unrelated URL passes to next()
    const next1 = vi.fn();
    middlewareHandler({ url: '/index.html' }, {}, next1);
    expect(next1).toHaveBeenCalled();

    // 2. Directory traversal attempt is blocked with 403
    const resForbidden: any = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    middlewareHandler({ url: `${MOONSHINE_URL_PREFIX}../package.json` }, resForbidden, vi.fn());
    expect(resForbidden.statusCode).toBe(403);
    expect(resForbidden.end).toHaveBeenCalledWith('Forbidden');

    // 3. Subdirectory traversal attempt is blocked with 403
    const resForbiddenSub: any = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    middlewareHandler({ url: `${MOONSHINE_URL_PREFIX}sub/file.js` }, resForbiddenSub, vi.fn());
    expect(resForbiddenSub.statusCode).toBe(403);

    // 4. Non-allowlist asset returns 404
    const resNotFound: any = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    middlewareHandler({ url: `${MOONSHINE_URL_PREFIX}unknown.js` }, resNotFound, vi.fn());
    expect(resNotFound.statusCode).toBe(404);
    expect(resNotFound.end).toHaveBeenCalledWith('Not Found');

    // 5. Allowed asset (moonshine.wasm) sets COOP/COEP and wasm MIME
    const resWasm: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader: vi.fn().mockImplementation((k, v) => {
        resWasm.headers[k] = v;
      }),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      write: vi.fn(),
    };
    middlewareHandler({ url: `${MOONSHINE_URL_PREFIX}moonshine.wasm` }, resWasm, vi.fn());
    expect(resWasm.headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(resWasm.headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(resWasm.headers['Content-Type']).toBe('application/wasm');
  });

  it('emits all 10 allowlisted files in generateBundle', () => {
    const plugin = moonshineAssetsPlugin() as any;
    plugin.configResolved?.({ root: process.cwd() });

    const emittedFiles: any[] = [];
    const context = {
      emitFile: vi.fn().mockImplementation((file) => {
        emittedFiles.push(file);
      }),
    };

    plugin.generateBundle.call(context);
    expect(emittedFiles).toHaveLength(10);
    const emittedNames = emittedFiles.map((f) => f.fileName);
    for (const file of MOONSHINE_ALLOWLIST) {
      expect(emittedNames).toContain(`moonshine/0.1.5/${file}`);
    }
  });

  it('public license file matches exact MIT notice and third-party notices', () => {
    const licensePath = path.resolve(process.cwd(), 'public/licenses/moonshine-voice-0.1.5.txt');
    expect(fs.existsSync(licensePath)).toBe(true);
    const content = fs.readFileSync(licensePath, 'utf8');
    expect(content).toContain('Moonshine Voice 0.1.5');
    expect(content).toContain('Copyright (c) 2025 Useful Sensors, Inc. (dba Moonshine AI)');
    expect(content).toContain('MIT License');
    expect(content).toContain('Mozilla Public License Version 2.0');
    expect(content).toContain('Apache License');
    expect(content).toContain('KISS FFT is provided under:');
    expect(content).toContain('utf8proc license');
  });
});
