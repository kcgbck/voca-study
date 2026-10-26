import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { moonshineAssetsPlugin } from './scripts/moonshineAssets';

let gitSha = process.env.VITE_GIT_SHA || process.env.CF_PAGES_COMMIT_SHA || '';
if (!gitSha) {
  try {
    gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    gitSha = 'dev';
  }
} else {
  gitSha = gitSha.slice(0, 7);
}

export default defineConfig({
  plugins: [react(), moonshineAssetsPlugin()],
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
    __APP_VERSION__: JSON.stringify('v0.2.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: [
      {
        find: /^onnxruntime-web$/,
        replacement: 'onnxruntime-web/webgpu',
      },
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
