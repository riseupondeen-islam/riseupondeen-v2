import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * The original app was a single index.html, so caching "/" was enough for offline use.
 * Vite emits hashed JS/CSS/data chunks, so after each build this plugin writes the list of
 * emitted assets (and a build id used in cache names) into dist/sw.js. Nothing else in the
 * service worker changes.
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rud-service-worker-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const assetsDir = join(outDir, 'assets');
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (!name.endsWith('.map')) files.push('/' + relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(assetsDir);
      files.sort();
      const buildId = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      const marker = /const RUD_V2_BUILD_ASSETS = \[\];\s*\/\* build:assets \*\//;
      const idMarker = /const RUD_V2_BUILD_ID = 'dev';\s*\/\* build:id \*\//;
      if (!marker.test(sw) || !idMarker.test(sw)) throw new Error('sw.js precache markers not found');
      writeFileSync(
        swPath,
        sw
          .replace(marker, `const RUD_V2_BUILD_ASSETS = ${JSON.stringify(files)}; /* build:assets */`)
          .replace(idMarker, `const RUD_V2_BUILD_ID = '${buildId}'; /* build:id */`),
      );
    },
  };
}

/* `vite build --mode e2e` swaps the Firebase SDK for the in-memory test double in
   tests/fake-firebase, so end-to-end tests never read or write the production project. */
const FAKE_FIREBASE_MODULES = ['app', 'auth', 'firestore', 'storage', 'messaging'];

export default defineConfig(({ mode }) => ({
  plugins: [react(), serviceWorkerPrecache()],
  resolve: {
    alias:
      mode === 'e2e'
        ? FAKE_FIREBASE_MODULES.map((name) => ({
            find: `firebase/${name}`,
            replacement: fileURLToPath(new URL(`./tests/fake-firebase/${name}.js`, import.meta.url)),
          }))
        : [],
  },
  build: {
    outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    target: 'es2020',
    sourcemap: false,
    // The Qur'an text chunk is ~2.5 MB of JSON by design (lazy-loaded, gzip-compressed by Hosting).
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
}));
