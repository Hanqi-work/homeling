import { describe, expect, test } from "bun:test";
import {
  CACHE_PREFIX,
  SW_VERSION,
  decide,
  isApiRequest,
  isShellRequest,
  ownedCaches,
} from "./strategy.ts";

function req(url: string, mode: RequestMode = "same-origin"): Request {
  return new Request(url, { mode: mode === "navigate" ? "navigate" : mode });
}

function url(u: string): URL {
  return new URL(u, "https://node.ts.net");
}

describe("strategy — isApiRequest", () => {
  test("/api/* at the root mount is an API request", () => {
    expect(isApiRequest(url("/api/snapshot"))).toBe(true);
  });

  test("/lite/api/* is an API request", () => {
    expect(isApiRequest(url("/lite/api/health"))).toBe(true);
  });

  test("shell assets are not API requests", () => {
    expect(isApiRequest(url("/lite/assets/app-abc.js"))).toBe(false);
  });
});

describe("strategy — isShellRequest", () => {
  test("the SPA index under /lite/ is shell", () => {
    expect(isShellRequest(url("/lite/"))).toBe(true);
    expect(isShellRequest(url("/lite/index.html"))).toBe(true);
  });

  test("build assets under /lite/assets/ are shell", () => {
    expect(isShellRequest(url("/lite/assets/main-1a2b3c.js"))).toBe(true);
    expect(isShellRequest(url("/lite/assets/index-9f8e.css"))).toBe(true);
  });

  test("sibling prefixes do not escape into shell", () => {
    expect(isShellRequest(url("/litefoo/app.js"))).toBe(false);
    expect(isShellRequest(url("/lite/../secrets.js"))).toBe(false);
  });
});

describe("strategy — decide", () => {
  test("navigation requests are network-first with nav-cache fallback", () => {
    const d = decide(req("https://node.ts.net/lite/", "navigate"), url("/lite/"));
    expect(d).toEqual({ kind: "network-first", cache: `${CACHE_PREFIX}-nav-${SW_VERSION}` });
  });

  test("API polling endpoints bypass the SW entirely", () => {
    expect(decide(req("https://node.ts.net/api/snapshot"), url("/api/snapshot"))).toEqual({ kind: "bypass" });
    expect(decide(req("https://node.ts.net/lite/api/health"), url("/lite/api/health"))).toEqual({ kind: "bypass" });
  });

  test("shell documents and assets are cache-first", () => {
    expect(decide(req("https://node.ts.net/lite/assets/main.js"), url("/lite/assets/main.js"))).toEqual({
      kind: "cache-first",
      cache: `${CACHE_PREFIX}-shell-${SW_VERSION}`,
    });
  });

  test("cross-origin requests (e.g. CDN) are bypassed, not cached", () => {
    expect(decide(req("https://cdn.example.com/lib.js"), url("https://cdn.example.com/lib.js"))).toEqual({
      kind: "bypass",
    });
  });

  test("unknown same-origin paths are bypassed (no over-caching)", () => {
    expect(decide(req("https://node.ts.net/favicon.ico"), url("/favicon.ico"))).toEqual({ kind: "bypass" });
  });
});

describe("strategy — ownedCaches", () => {
  test("a new SW version owns differently-named caches, enabling stale-cache pruning", () => {
    const current = ownedCaches(SW_VERSION);
    const next = ownedCaches("v2");
    expect(current.shell).not.toBe(next.shell);
    expect(current.nav).not.toBe(next.nav);
    expect(next.shell).toBe(`${CACHE_PREFIX}-shell-v2`);
  });
});
