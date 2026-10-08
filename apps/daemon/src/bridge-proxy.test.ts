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
  test("snapshot and pane history pass only as GET; reply passes only as POST", () => {
    expect(allowBridgePath("/api/snapshot")).toBe(true);
    expect(allowBridgePath("/api/pane/w5N:p1/history")).toBe(true);
    expect(allowBridgePath("/api/pane/w5N%3Ap1/history")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/history")).toBe(true);
    expect(allowBridgePath("/api/pane/w1:p2/reply", "POST")).toBe(true);
    expect(allowBridgePath("/api/pane/w1:p2/reply")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/reply", "GET")).toBe(false);
    expect(allowBridgePath("/api/launchers")).toBe(true);
    expect(allowBridgePath("/api/launchers", "POST")).toBe(false);
    expect(allowBridgePath("/api/launch", "POST")).toBe(true);
    expect(allowBridgePath("/api/launch")).toBe(false);
  });

  test("everything a browser must not reach through the daemon is refused", () => {
    expect(allowBridgePath("/api/pane/w1:p2/reply")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/chat")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2/close")).toBe(false);
    expect(allowBridgePath("/api/pane/w1:p2")).toBe(false);
    expect(allowBridgePath("/api/launch")).toBe(false);
    expect(allowBridgePath("/api/launchers")).toBe(true);
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
    expect(proxyTargetUrl("/lite/api/launchers", cfg)).toBe(`${cfg.bridgeOrigin}/api/launchers`);
    expect(proxyTargetUrl("/lite/api/launch", cfg, "POST")).toBe(`${cfg.bridgeOrigin}/api/launch`);
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

  test("POST reply refuses simple-form content types before contacting Collie", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return Response.json({ ok: true }); };
    const response = await proxyBridgeRequest(new Request("http://daemon.test/lite/api/pane/p1/reply", {
      method: "POST", headers: { "content-type": "text/plain" }, body: '{"text":"hi"}',
    }), cfg, fetcher);
    expect(response.status).toBe(415);
    expect(calls).toBe(0);
  });

  test("reply route keeps the same encoded-path traversal protections", () => {
    for (const payload of [
      "/lite/api/pane/p1/%2e%2e/reply",
      "/lite/api/pane/%252e%252e%5cconfig%23/reply",
      "/lite/api/pane/p1%3Fother/reply",
      "/lite/api/pane/p1%2F..%2Fconfig/reply",
    ]) {
      expect(() => proxyTargetUrl(payload, cfg, "POST")).toThrow();
    }
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

  test("POST launch forwards the exact JSON body to the exact bridge route", async () => {
    const body = '{"command":"bun test --watch","paneId":"w1:p2"}';
    const forwarded: Array<{ url: string; method: string; body: string }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      forwarded.push({ url: String(input), method: init?.method ?? "", body: await new Response(init?.body).text() });
      return Response.json({ ok: true, pane: { paneId: "w2:p1" } });
    };
    const response = await proxyBridgeRequest(new Request("http://daemon.test/lite/api/launch", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }), cfg, fetcher);
    expect(response.status).toBe(200);
    expect(forwarded).toEqual([{ url: `${cfg.bridgeOrigin}/api/launch`, method: "POST", body }]);
  });

  test("POST launch reports timeout as an explicit unknown task outcome", async () => {
    const fetcher = async () => { throw new DOMException("timed out", "TimeoutError"); };
    const response = await proxyBridgeRequest(new Request("http://daemon.test/lite/api/launch", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"command":"bun test"}',
    }), cfg, fetcher);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false, error: "Launch timed out; task status is unknown", code: "launch.timeout",
    });
  });

  test("POST launch returns an explicit structured bridge failure", async () => {
    const fetcher = async () => { throw new Error("offline"); };
    const response = await proxyBridgeRequest(new Request("http://daemon.test/lite/api/launch", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"command":"bun test"}',
    }), cfg, fetcher);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "Bridge unavailable", code: "bridge.unavailable" });
  });

  test("POST reply forwards the exact validated URL and raw JSON body", async () => {
    const body = '{"text":"hello\n世界","submit":true,"expected_prompt":"prompt"}';
    let fetchUrl = "";
    let fetchBody = "";
    let fetchMethod = "";
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchUrl = String(input);
      fetchBody = await new Response(init?.body).text();
      fetchMethod = init?.method ?? "";
      return Response.json({ ok: true });
    };
    const path = "/lite/api/pane/w1:p2/reply";
    const validatedUrl = proxyTargetUrl(path, cfg, "POST");
    const response = await proxyBridgeRequest(new Request(`http://daemon.test${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }), cfg, fetcher);
    expect(response.status).toBe(200);
    expect(fetchUrl).toBe(validatedUrl);
    expect(fetchBody).toBe(body);
    expect(fetchMethod).toBe("POST");
  });

  test("the bridge origin is environment-configurable and loopback by default", () => {
    process.env.HOMELING_BRIDGE_ORIGIN = "http://127.0.0.1:9999/";
    const c = daemonConfigFromEnv({});
    expect(c.bridgeOrigin).toBe("http://127.0.0.1:9999");
    expect(proxyTargetUrl("/lite/api/snapshot", c)).toBe("http://127.0.0.1:9999/api/snapshot");
  });
});
