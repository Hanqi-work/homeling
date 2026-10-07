/**
 * Pure fetch-strategy logic for the Homeling service worker, extracted so it can be unit-tested
 * without a real SW environment. The sw.js runtime maps these decisions onto the Cache API.
 */
export const SW_VERSION = "v1";
export const CACHE_PREFIX = "homeling-lite";
/** Cache holding the precached app shell; versioned so updates start a fresh cache. */
export const SHELL_CACHE = `${CACHE_PREFIX}-shell-${SW_VERSION}`;
/** Cache holding the last good index.html for offline navigation fallback. */
export const NAV_CACHE = `${CACHE_PREFIX}-nav-${SW_VERSION}`;

/** The app shell: the document itself and same-origin build assets under the /lite mount. */
export function isShellRequest(url: URL): boolean {
  return url.pathname === "/lite/" || url.pathname === "/lite/index.html" || url.pathname.startsWith("/lite/assets/");
}

/** Polling/API endpoints must always hit the network and never be written to any cache. */
export function isApiRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/lite/api/");
}

export type FetchDecision =
  | { kind: "bypass" }
  | { kind: "cache-first"; cache: string }
  | { kind: "network-first"; cache: string };

/**
 * Decide how the SW should handle a request:
 * - API (including /api/* at the root mount): bypass entirely — never cached, never short-circuited.
 * - App shell: cache-first (instant loads, offline).
 * - Navigation (reload of a deep link): network-first with cached-shell fallback.
 */
export function decide(request: Request, url: URL): FetchDecision {
  if (request.mode === "navigate") {
    return { kind: "network-first", cache: NAV_CACHE };
  }
  if (isApiRequest(url)) {
    return { kind: "bypass" };
  }
  if (isShellRequest(url)) {
    return { kind: "cache-first", cache: SHELL_CACHE };
  }
  return { kind: "bypass" };
}

/** Cache name for a given SW version — used by the activate step to prune stale caches. */
export function ownedCaches(version: string): { shell: string; nav: string } {
  return { shell: `${CACHE_PREFIX}-shell-${version}`, nav: `${CACHE_PREFIX}-nav-${version}` };
}
