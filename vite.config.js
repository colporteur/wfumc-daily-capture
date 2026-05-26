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
      // injectManifest strategy lets us own the service worker. We
      // need this for Web Share Target with method='POST' so the SW
      // can intercept the share intent, read the uploaded transcript
      // file, and hand it off to the React page. The default
      // generateSW strategy can't handle POST navigations.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        // mammoth + future bundle growth — keep room in the precache.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
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
        // Web Share Target: when this PWA is installed on Android,
        // the OS's share sheet will show "WFUMC Daily Capture" as a
        // target for shared text/files. Plaud emits a .txt transcript
        // file when you share — `files` declares we accept it.
        //   action     — relative to scope, so this becomes
        //                <scope>share (e.g. /wfumc-daily-capture/share)
        //   method     — POST is required for file shares
        //   enctype    — multipart for file uploads
        //   params     — names of the form fields the OS will populate
        //   files      — the accepted MIME types and form field name
        //
        // We also accept the GET-style text/title/url params as a
        // fallback so apps that share plain text (rather than a file)
        // still work.
        share_target: {
          action: 'share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'file',
                accept: ['text/plain', '.txt', 'text/*'],
              },
            ],
          },
        },
      },
    }),
  ],
  server: {
    // Pick a port distinct from the other WFUMC apps so they can all
    // be running locally at the same time.
    port: 5178,
  },
});
