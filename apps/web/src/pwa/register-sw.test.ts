import { afterEach, describe, expect, test } from "bun:test";
import { applySwUpdateFrom, hasServiceWorkerSupport, registerServiceWorker, type SwRegistration } from "./register-sw.ts";

describe("hasServiceWorkerSupport", () => {
  test("false without navigator.serviceWorker (SSR / test env)", () => {
    expect(hasServiceWorkerSupport({ navigator: {} as Navigator })).toBe(false);
  });

  test("true when serviceWorker container exists", () => {
    expect(hasServiceWorkerSupport({ navigator: { serviceWorker: {} } as unknown as Navigator })).toBe(true);
  });
});

describe("registerServiceWorker — degraded environments", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", { value: originalWindow, writable: true, configurable: true });
  });

  test("returns null and never throws when SW is unsupported (SSR/test)", async () => {
    Object.defineProperty(globalThis, "window", {
      value: { navigator: {} },
      writable: true,
      configurable: true,
    });
    let called = false;
    const handle = await registerServiceWorker(() => {
      called = true;
    });
    expect(handle).toBeNull();
    expect(called).toBe(false);
  });
});

describe("applySwUpdateFrom", () => {
  const originalWindow = globalThis.window;
  let reloads: number;
  let posted: string | null;

  function installFakeWindow(): void {
    reloads = 0;
    posted = null;
    Object.defineProperty(globalThis, "window", {
      value: {
        navigator: { serviceWorker: { controller: {} } },
        location: { reload: () => (reloads += 1) },
      },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "window", { value: originalWindow, writable: true, configurable: true });
  });

  test("applyUpdate posts SKIP_WAITING to the waiting worker and reloads", () => {
    installFakeWindow();
    const registration = {
      waiting: { postMessage: (msg: string) => (posted = msg) },
    } as unknown as ServiceWorkerRegistration;
    const handle: SwRegistration = applySwUpdateFrom(registration);
    handle.applyUpdate();
    expect(posted).toBe("SKIP_WAITING");
    expect(reloads).toBe(1);
  });

  test("applyUpdate without a waiting worker still reloads", () => {
    installFakeWindow();
    const registration = { waiting: null } as unknown as ServiceWorkerRegistration;
    const handle: SwRegistration = applySwUpdateFrom(registration);
    handle.applyUpdate();
    expect(reloads).toBe(1);
  });
});
