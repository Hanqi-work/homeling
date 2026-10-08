import { afterEach, describe, expect, test } from "bun:test";
import {
  allowBridgePath,
  proxyBridgeRequest,
  proxyTargetUrl,
} from "./bridge-proxy.ts";
import { daemonConfigFromEnv } from "./config.ts";

const cfg = daemonConfigFromEnv({});

const savedEnv: Record<string, string | undefined> = {};
for (const key of ["HOMELING_BRIDGE_ORIGIN", "HOMELING_TRUSTED_USERS", "HOMELING_TAILSCALE_HOST"]) {
  savedEnv[key] = process.env[key];
}
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("allowBridgePath — the narrow allowlist", () => {
  test("snapshot and pane history pass", () => {
    expect(allowBridgePath("/api/snapshot")).toBe(true);
    expect(allowBridgePath("/api/pane/w5N:p1/history")).toBe(true);
    expect(allowBridgePath("/api/pane/w5N%3Ap1/history")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/history")).toBe(true);
  });

  test("everything a browser must not reach through the daemon is refused", () => {
    expect(allowBridgePath("/api/pane/w1:p2/reply")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/chat")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/close")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2")).toBe(false);
    expect(allowBridgePath("/api/launch")).toBe(false);
    expect(allowBridgePath("/api/launchers")).toBe(false);
    expect(allowBridgePath("/api/snapshot/x")).toBe(false);
    expect(allowBridgePath("/api/snapshots")).toBe(false);
    expect(allowBridgePath("/api/panes")).toBe(false);
    expect(allowBridgePath("/")).toBe(false);
    expect(allowBridgePath("/api/snapshot/../secrets")).toBe(false);
  });
});

describe("proxyTargetUrl", () => {
  test("rewrites /lite/api/* to the bridge origin, preserving the query string", () => {
    expect(proxyTargetUrl("/lite/api/snapshot", cfg)).toBe(`${cfg.bridgeOrigin}/api/snapshot`);
    expect(proxyTargetUrl("/lite/api/snapshot?x=1", cfg)).toBe(`${cfg.bridgeOrigin}/api/snapshot?x=1`);
    expect(proxyTargetUrl("/lite/api/pane/w1:p2/history?limit=60&before=abc", cfg)).toBe(
      `${cfg.bridgeOrigin}/api/pane/w1:p2/history?limit=60&before=abc`,
    );
    expect(proxyTargetUrl("/lite/api/pane/w5N%3Ap1/history", cfg)).toBe(
      `${cfg.bridgeOrigin}/api/pane/w5N:p1/history`,
    );
    expect(proxyTargetUrl("/lite/api/pane/w1:p2/history?before=a%20b&extra=x", cfg)).toBe(
      `${cfg.bridgeOrigin}/api/pane/w1:p2/history?before=a%20b&extra=x`,
    );
  });

  test("paths outside /lite/api/* never proxy", () => {
    expect(() => proxyTargetUrl("/lite", cfg)).toThrow();
    expect(() => proxyTargetUrl("/lite/api/health", cfg)).toThrow();
    expect(() => proxyTargetUrl("/api/snapshot", cfg)).toThrow();
    expect(() => proxyTargetUrl("/etc/passwd", cfg)).toThrow();
  });

  test("traversal and non-allowlisted sub-actions are refused, raw or encoded", () => {
    expect(() => proxyTargetUrl("/lite/api/pane/p1/%2e%2e/history", cfg)).toThrow();
    expect(() => proxyTargetUrl("/lite/api/snapshot/../config", cfg)).toThrow();
    expect(() => proxyTargetUrl("/lite/api/pane/p1/reply", cfg)).toThrow();
  });

  test("rejects encoded path delimiters before constructing the fetch URL", () => {
    const payloads = [
      "/lite/api/pane/p1/%2e%2e/history",
      "/lite/api/alias/../snapshot",
      "/lite/api/pane/%252e%252e%5cconfig%23/history",
      "/lite/api/pane/p1%3Fother/history",
      "/lite/api/pane/p1%2F..%2Fconfig/history",
      "/lite/api/pane/p1%5Cconfig/history",
    ];
    for (const payload of payloads) expect(() => proxyTargetUrl(payload, cfg)).toThrow();
  });

  test("never calls bridge fetch when original or double-encoded traversal payloads are rejected", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return Response.json({}); };
    const payloads = [
      "/lite/api/pane/p1/%2e%2e/history",
      "/lite/api/pane/%252e%252e%5cconfig%23/history",
    ];
    for (const payload of payloads) {
      const response = await proxyBridgeRequest(new Request(`http://daemon.test${payload}`), cfg, fetcher);
      expect(response.status).toBe(404);
    }
    expect(calls).toBe(0);
  });

  test("the bridge origin is environment-configurable and loopback by default", () => {
    process.env.HOMELING_BRIDGE_ORIGIN = "http://127.0.0.1:9999/";
    const c = daemonConfigFromEnv({});
    expect(c.bridgeOrigin).toBe("http://127.0.0.1:9999");
    expect(proxyTargetUrl("/lite/api/snapshot", c)).toBe("http://127.0.0.1:9999/api/snapshot");
  });
});
