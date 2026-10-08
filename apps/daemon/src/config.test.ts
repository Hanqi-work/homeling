import { describe, expect, test } from "bun:test";
import { daemonConfigFromEnv } from "./config.ts";

describe("daemonConfigFromEnv", () => {
  function withEnv(env: Record<string, string>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  test("defaults: loopback 8790, apps/web/dist, no trusted users yet", () => {
    withEnv({}, () => {
      const c = daemonConfigFromEnv({});
      expect(c.port).toBe(8790);
      expect(c.webDist.endsWith("apps/web/dist")).toBe(true);
      expect(c.trustedUsers).toEqual([]);
      expect(c.tailscaleHost).toBe("");
      expect(c.allowAnyHost).toBe(false);
    });
  });

  test("env overrides: port, web dist, trusted users, tailscale host", () => {
    withEnv(
      {
        HOMELING_PORT: "9000",
        HOMELING_WEB_DIST: "/srv/web",
        HOMELING_TRUSTED_USERS: "a@x.com, b@x.com",
        HOMELING_TAILSCALE_HOST: "host.tail1234.ts.net",
        HOMELING_ALLOW_ANY_HOST: "1",
      },
      () => {
        const c = daemonConfigFromEnv({});
        expect(c.port).toBe(9000);
        expect(c.webDist).toBe("/srv/web");
        expect(c.trustedUsers).toEqual(["a@x.com", "b@x.com"]);
        expect(c.tailscaleHost).toBe("host.tail1234.ts.net");
        expect(c.allowAnyHost).toBe(true);
      },
    );
  });

  test("registry and Herdr socket paths are configurable", () => {
    const c = daemonConfigFromEnv({ HOMELING_REGISTRY_PATH: "/tmp/registry.json", HERDR_SOCKET_PATH: "/tmp/herdr.sock" });
    expect(c.registryPath).toBe("/tmp/registry.json");
    expect(c.herdrSocketPath).toBe("/tmp/herdr.sock");
  });

  test("explicit env object wins over process.env", () => {
    withEnv({ HOMELING_PORT: "9001" }, () => {
      const c = daemonConfigFromEnv({ HOMELING_PORT: "9002" });
      expect(c.port).toBe(9002);
    });
  });

  test("invalid port falls back to default", () => {
    const c = daemonConfigFromEnv({ HOMELING_PORT: "not-a-port" });
    expect(c.port).toBe(8790);
  });

  test("bridge origin must remain a loopback HTTP origin", () => {
    expect(() => daemonConfigFromEnv({ HOMELING_BRIDGE_ORIGIN: "https://bridge.example.com" })).toThrow(/loopback HTTP origin/);
    expect(() => daemonConfigFromEnv({ HOMELING_BRIDGE_ORIGIN: "http://127.0.0.1:8787/api" })).toThrow(/loopback HTTP origin/);
    expect(daemonConfigFromEnv({ HOMELING_BRIDGE_ORIGIN: "http://127.0.0.2:8788/" }).bridgeOrigin).toBe("http://127.0.0.2:8788");
  });
});
