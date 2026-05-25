import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Set BASE_PATH in your build env to match the GitHub Pages repo path,
// e.g. "/wfumc-daily-capture/". Defaults to "/" for local dev.
const base = process.env.VITE_BASE_PATH || '/';

// Build-time stamp injected into the bundle so the version marker at
// the bottom of every page knows when this build was cut.
const buildTime = new Date().toISOString();
const buildSha = (process.env.GITHUB_SHA || 'local').slice(0, 7);

export default defineConfig({
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*'],
      manifest: {
        name: 'WFUMC Daily Capture',
        short_name: 'Capture',
        description:
          'Triage daily transcripts (Plaud / Voice Memos) into pastoral records and sermon resources.',
        theme_color: '#5b1a1a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // mammoth is heavy; bump the cache cap so it can be precached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    // Pick a port distinct from the other WFUMC apps so they can all
    // be running locally at the same time.
    port: 5178,
  },
});
