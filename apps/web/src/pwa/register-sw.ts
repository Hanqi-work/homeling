/**
 * Service worker registration + update lifecycle for the /lite PWA.
 *
 * - Registers /lite/sw.js (scope /lite/), no-ops when SW is unavailable (SSR, tests, insecure
 *   contexts) so import is always safe.
 * - When a waiting worker is found (i.e. a new version was installed but is not controlling
 *   pages yet), calls `onUpdateAvailable` once — the UI surfaces a "new version, tap to reload"
 *   hint; `applyUpdate()` triggers it (skipWaiting was already called on install) and reloads.
 */
export interface SwRegistration {
  /** Ask the waiting worker to take over and reload the page. */
  applyUpdate(): void;
}

export function applySwUpdateFrom(registration: ServiceWorkerRegistration): SwRegistration {
  return {
    applyUpdate() {
      if (registration.waiting) {
        registration.waiting.postMessage("SKIP_WAITING");
      }
      window.location.reload();
    },
  };
}

export function hasServiceWorkerSupport(win: Pick<Window, "navigator">): boolean {
  return typeof win.navigator !== "undefined" && "serviceWorker" in win.navigator;
}

/**
 * Register the /lite SW. Returns the registration handle or null when unsupported/failed.
 * Never throws — a PWA-less environment must not break the app.
 */
export async function registerServiceWorker(
  onVersionAvailable?: (handle: SwRegistration) => void,
): Promise<SwRegistration | null> {
  if (!hasServiceWorkerSupport(window)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/lite/sw.js", { scope: "/lite/" });
    if (registration.waiting && navigator.serviceWorker.controller) {
      onVersionAvailable?.(applySwUpdateFrom(registration));
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          onVersionAvailable?.(applySwUpdateFrom(registration));
        }
      });
    });
    return applySwUpdateFrom(registration);
  } catch {
    return null;
  }
}

export function applySwUpdate(handle: SwRegistration): void {
  handle.applyUpdate();
}

/** Test-only: reset nothing here; kept for future fixtures. */
export const SW_URL = "/lite/sw.js";
