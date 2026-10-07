/**
 * Homeling /lite service worker.
 *
 * Scope: served at /lite/sw.js, so its scope is /lite/ by default — it never controls the
 * root-path UI, and no Service-Worker-Allowed header is needed (the worker lives inside its
 * own scope). Bump SW_VERSION to ship an update: activate deletes stale caches, and the page
 * learns about the waiting worker via registration.waiting (see src/pwa/register-sw.ts).
 *
 * Caching policy (spec mirrors src/sw/strategy.ts, which holds the unit-tested pure logic):
 * - /api/* and /lite/api/*: bypass — never cached, never short-circuited (polling endpoints).
 * - app shell (/lite/index.html, /lite/assets/*): cache-first.
 * - navigations (deep links / refresh): network-first, cached shell as offline fallback.
 */
const SW_VERSION = "v1";
const CACHE_PREFIX = "homeling-lite";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${SW_VERSION}`;
const NAV_CACHE = `${CACHE_PREFIX}-nav-${SW_VERSION}`;
const PRECACHE = ["/lite/", "/lite/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== SHELL_CACHE && name !== NAV_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API endpoints (both mounts) always hit the network untouched — no caching, no fallback.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/lite/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          const cache = await caches.open(NAV_CACHE);
          cache.put("/lite/", response.clone());
          return response;
        })
        .catch(async () => {
          const navCache = await caches.open(NAV_CACHE);
          return (await navCache.match("/lite/")) ?? (await caches.match("/lite/index.html")) ?? Response.error();
        }),
    );
    return;
  }

  // Cache-first for the app shell: same-origin build assets and the document itself.
  const isShellAsset =
    url.origin === self.location.origin &&
    (url.pathname === "/lite/index.html" || url.pathname.startsWith("/lite/assets/"));
  if (isShellAsset) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request).then(async (response) => {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(event.request, response.clone());
            return response;
          }),
      ),
    );
  }
});

// Update handshake: the page sends SKIP_WAITING via registration.waiting.postMessage();
// since install already called skipWaiting, this message is a no-op safety net — the reload
// in register-sw.ts picks up the activated worker either way.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
