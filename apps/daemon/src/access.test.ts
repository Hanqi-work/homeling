import { describe, expect, test } from "bun:test";
import { checkAccess, type AccessConfig } from "./access.ts";

const TAILNET_HOST = "rolexdemacbook-air.tail616cc1.ts.net";

function cfg(overrides: Partial<AccessConfig> = {}): AccessConfig {
  return { trustedUsers: ["me@github.com"], allowAnyHost: false, tailscaleHost: TAILNET_HOST, ...overrides };
}

function req(opts: {
  remoteAddress?: string;
  host?: string;
  login?: string;
  origin?: string;
  method?: string;
}): Request {
  const headers = new Headers();
  if (opts.host !== undefined) headers.set("host", opts.host);
  if (opts.login !== undefined) headers.set("tailscale-user-login", opts.login);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  // `remoteAddress` is a Bun extension not carried by the Request init object — attach directly.
  return Object.assign(
    new Request("https://placeholder/lite/api/health", {
      method: opts.method ?? "GET",
      headers,
    }),
    { remoteAddress: opts.remoteAddress },
  );
}

describe("checkAccess — fail-closed identity", () => {
  test("non-loopback request without identity header is rejected", () => {
    const r = checkAccess(req({ remoteAddress: "100.64.0.9", host: `${TAILNET_HOST}:443` }), cfg());
    expect(r.ok).toBe(false);
  });

  test("trusted login passes", () => {
    const r = checkAccess(
      req({ remoteAddress: "100.64.0.9", host: `${TAILNET_HOST}:443`, login: "me@github.com" }),
      cfg(),
    );
    expect(r.ok).toBe(true);
  });

  test("non-trusted login is rejected", () => {
    const r = checkAccess(
      req({ remoteAddress: "100.64.0.9", host: `${TAILNET_HOST}:443`, login: "stranger@github.com" }),
      cfg(),
    );
    expect(r.ok).toBe(false);
  });

  test("empty trustedUsers rejects any login (deny-all)", () => {
    const r = checkAccess(
      req({ remoteAddress: "100.64.0.9", host: `${TAILNET_HOST}:443`, login: "me@github.com" }),
      cfg({ trustedUsers: [] }),
    );
    expect(r.ok).toBe(false);
  });

  test("identity header is not trusted from loopback spoofing checks — loopback is trusted by address, not header", () => {
    // A loopback request with a bogus login still passes: address decides, header never revokes.
    const r = checkAccess(
      req({ remoteAddress: "127.0.0.1", host: "localhost:8790", login: "stranger@github.com" }),
      cfg(),
    );
    expect(r.ok).toBe(true);
  });
});

describe("checkAccess — loopback trust", () => {
  test("loopback address without identity header passes", () => {
    for (const addr of ["127.0.0.1", "[::1]", "::1"]) {
      const r = checkAccess(req({ remoteAddress: addr, host: "localhost:8790" }), cfg());
      expect(r.ok).toBe(true);
    }
  });
});

describe("checkAccess — Host allowlist", () => {
  test("tailscale hostname and loopback hosts pass", () => {
    for (const host of [`${TAILNET_HOST}:443`, TAILNET_HOST, "localhost:8790", "127.0.0.1:8790", "[::1]:8790"]) {
      const r = checkAccess(req({ remoteAddress: "127.0.0.1", host, login: "me@github.com" }), cfg());
      expect(r.ok).toBe(true);
    }
  });

  test("foreign host is rejected even with a trusted login (DNS rebinding)", () => {
    const r = checkAccess(
      req({ remoteAddress: "100.64.0.9", host: "evil.example.com", login: "me@github.com" }),
      cfg(),
    );
    expect(r.ok).toBe(false);
  });

  test("missing Host header is rejected", () => {
    const r = checkAccess(req({ remoteAddress: "127.0.0.1", host: "" }), cfg());
    expect(r.ok).toBe(false);
  });

  test("allowAnyHost opt-out skips the Host check but not the identity check", () => {
    const c = cfg({ allowAnyHost: true });
    expect(checkAccess(req({ remoteAddress: "100.64.0.9", host: "evil.example.com" }), c).ok).toBe(false);
    expect(
      checkAccess(req({ remoteAddress: "100.64.0.9", host: "evil.example.com", login: "me@github.com" }), c).ok,
    ).toBe(true);
  });
});

describe("checkAccess — same-origin (CSRF)", () => {
  test("matching Origin passes", () => {
    const r = checkAccess(
      req({
        remoteAddress: "100.64.0.9",
        host: `${TAILNET_HOST}:443`,
        login: "me@github.com",
        origin: `https://${TAILNET_HOST}`,
      }),
      cfg(),
    );
    expect(r.ok).toBe(true);
  });

  test("cross-origin Origin is rejected", () => {
    const r = checkAccess(
      req({
        remoteAddress: "100.64.0.9",
        host: `${TAILNET_HOST}:443`,
        login: "me@github.com",
        origin: "https://evil.example.com",
      }),
      cfg(),
    );
    expect(r.ok).toBe(false);
  });

  test("loopback Host does not make a foreign Origin same-origin for writes", () => {
    const r = checkAccess(
      req({
        remoteAddress: "127.0.0.1",
        host: "localhost:8790",
        origin: "https://evil.example.com",
        method: "POST",
      }),
      cfg(),
    );
    expect(r).toEqual({ ok: false, reason: "cross-origin rejected" });
  });

  test("reverse-proxy loopback peer with a tailscale Host is not trusted as a local caller", () => {
    const noOrigin = checkAccess(
      req({ remoteAddress: "127.0.0.1", host: `${TAILNET_HOST}:443`, method: "POST" }),
      cfg(),
    );
    expect(noOrigin).toEqual({ ok: false, reason: "origin required" });

    const noIdentity = checkAccess(
      req({ remoteAddress: "127.0.0.1", host: `${TAILNET_HOST}:443`, origin: `https://${TAILNET_HOST}`, method: "POST" }),
      cfg(),
    );
    expect(noIdentity).toEqual({ ok: false, reason: "identity required" });
  });

  test("write without Origin from non-loopback Host is rejected", () => {
    const r = checkAccess(
      req({ remoteAddress: "100.64.0.9", host: `${TAILNET_HOST}:443`, login: "me@github.com", method: "POST" }),
      cfg(),
    );
    expect(r.ok).toBe(false);
  });

  test("write without Origin from loopback passes", () => {
    const r = checkAccess(
      req({ remoteAddress: "127.0.0.1", host: "localhost:8790", method: "POST" }),
      cfg(),
    );
    expect(r.ok).toBe(true);
  });

  test("Origin with port suffix still matches Host with port", () => {
    const r = checkAccess(
      req({
        remoteAddress: "100.64.0.9",
        host: `${TAILNET_HOST}:443`,
        login: "me@github.com",
        origin: `https://${TAILNET_HOST}:443`,
      }),
      cfg(),
    );
    expect(r.ok).toBe(true);
  });
});
