// Custom service worker for the Daily Capture PWA.
//
// Why custom (not the vite-plugin-pwa default generateSW): the Web
// Share Target API requires method='POST' with multipart/form-data so
// we can receive shared files (Plaud emits a .txt transcript file
// when its Share button is tapped). The default generateSW strategy
// can't intercept POST navigations — only an explicitly-owned SW can.
//
// What this file does:
//   1. Precaches the app shell via workbox so the PWA loads offline.
//   2. Auto-update behavior: skipWaiting + clientsClaim so a new
//      version activates without requiring the pastor to close every
//      tab. (vite-plugin-pwa's registerType:'autoUpdate' lines up
//      with this — the registration code it generates calls
//      .update() periodically.)
//   3. Intercepts POST <scope>share — reads the shared file (preferred)
//      OR the shared text (fallback), stashes the payload in a
//      private cache under a fixed key, then redirects to
//      GET <scope>share?from=sw so the React page can pick it up.
//   4. Exposes a GET <scope>__share_consume__ endpoint that returns
//      the stashed payload as JSON and atomically clears the cache,
//      so a stale share never resurfaces on next page open.

import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

// Activate immediately. With registerType:'autoUpdate' the
// vite-plugin-pwa register script calls .update() so the new SW
// installs in the background; skipWaiting + clientsClaim makes the
// new version active for all tabs without requiring them to be
// closed.
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Private cache used as the share-target hand-off bucket. Single
// fixed key — only the most recent unconsumed share is held at any
// time, which matches the actual UX (you share, the next tap opens
// the app to consume it; you don't share five things in parallel).
const SHARE_CACHE = 'wfumc-capture-share-v1';
const SHARE_KEY = '/__shared_transcript__';

// Build the post-redirect URL inside the app's base path. The SW
// lives at the root of its scope, so registration.scope ends with
// a trailing slash (e.g. https://x.github.io/wfumc-daily-capture/).
function buildShareUrl(from) {
  return self.registration.scope + 'share?from=' + encodeURIComponent(from);
}

// --- POST /share interceptor ---------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // POST share-target intent. Pathname endsWith covers both
  // dev (/share) and Pages-deployed (/wfumc-daily-capture/share).
  if (
    event.request.method === 'POST' &&
    url.pathname.endsWith('/share')
  ) {
    event.respondWith(handleShareIntent(event.request));
    return;
  }

  // Page calling /__share_consume__ to read + clear the payload.
  if (
    event.request.method === 'GET' &&
    url.pathname.endsWith('/__share_consume__')
  ) {
    event.respondWith(handleShareConsume());
    return;
  }
});

async function handleShareIntent(request) {
  try {
    const formData = await request.formData();

    // Prefer the file (Plaud's native share format) — fall back to
    // the text param if no file was attached or the file came up
    // empty for any reason.
    let text = '';
    let filename = null;
    const files = formData.getAll('file');
    for (const f of files) {
      if (f && typeof f.text === 'function') {
        try {
          const t = await f.text();
          if (t && t.trim()) {
            text = t;
            filename = typeof f.name === 'string' ? f.name : null;
            break;
          }
        } catch {
          // Move to the next file or fall through to the text param.
        }
      }
    }
    if (!text.trim()) {
      const t = formData.get('text');
      if (typeof t === 'string') text = t;
    }

    const payload = {
      text,
      title: String(formData.get('title') || ''),
      url: String(formData.get('url') || ''),
      filename,
      shared_at: new Date().toISOString(),
    };

    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      SHARE_KEY,
      new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      })
    );

    return Response.redirect(buildShareUrl('sw'), 303);
  } catch (e) {
    // Redirect with an error flag so the page can render a
    // friendly message rather than spin forever.
    return Response.redirect(buildShareUrl('error'), 303);
  }
}

async function handleShareConsume() {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const hit = await cache.match(SHARE_KEY);
    // Always clear; even a stale read shouldn't leave the payload
    // sitting around for a future tab open.
    await cache.delete(SHARE_KEY);
    if (!hit) {
      return new Response(JSON.stringify({}), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = await hit.text();
    return new Response(body, {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({}), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
