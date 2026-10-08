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
const SW_VERSION = "v2-push";
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
  if (event.data?.type === "HOMELING_RETRACT" && typeof event.data.tag === "string" && event.source?.url) {
    const source = new URL(event.source.url);
    if (source.origin === self.location.origin && source.pathname.startsWith("/lite/")) {
      event.waitUntil(self.registration.getNotifications({ tag: event.data.tag }).then((items) => items.forEach((item) => item.close())));
    }
  }
});

function liteNotificationUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && !url.username && !url.password && url.pathname.startsWith("/lite/") && !url.pathname.startsWith("/lite/api/")) return url.href;
  } catch {}
  return `${self.location.origin}/lite/`;
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (payload?.version !== 1 || payload.type !== "notification" || typeof payload.title !== "string" || typeof payload.body !== "string" || typeof payload.tag !== "string") return;
    await self.registration.showNotification(payload.title.slice(0, 120), {
      body: payload.body.slice(0, 500), tag: payload.tag.slice(0, 200),
      icon: "/lite/icons/icon-192.png", badge: "/lite/icons/icon-192.png",
      data: { url: liteNotificationUrl(payload.url) },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = liteNotificationUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Never navigate or focus Collie's root-path UI.
    const existing = windows.find((client) => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && url.pathname.startsWith("/lite/");
    });
    if (existing) {
      try {
        const navigated = await existing.navigate(target);
        if (navigated) { await navigated.focus(); return; }
      } catch {
        // The tab may have disappeared while the click was being handled; open a fresh lite tab.
      }
    }
    await self.clients.openWindow(target);
  })());
});
