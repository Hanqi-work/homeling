import { describe, expect, test } from "bun:test";
import { handleRequest } from "./index.ts";
import type { DaemonConfig } from "./config.ts";

const host = "homeling.tail.test";
const cfg: DaemonConfig = {
  port: 8790, hostname: "127.0.0.1", webDist: "/unused", indexHtml: "index.html",
  trustedUsers: ["me@test"], tailscaleHost: host, allowAnyHost: false, bridgeOrigin: "http://127.0.0.1:8787",
};
function request(path = "/lite/api/stt", options: RequestInit = {}) {
  return Object.assign(new Request(`https://${host}${path}`, {
    method: "POST", body: new Uint8Array([0, 128, 255, 42]), ...options,
    headers: { host, origin: `https://${host}`, "tailscale-user-login": "me@test", "content-type": "audio/webm;codecs=opus", ...options.headers },
  }), { remoteAddress: "127.0.0.1" });
}

describe("daemon STT", () => {
  test("rejects non-audio, empty and oversized bodies before contacting bridge", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return Response.json({ ok: true }); };
    for (const type of ["application/json", "text/plain", "multipart/form-data", "audio/unknown", "constructor"]) {
      expect((await handleRequest(request(undefined, { headers: { "content-type": type } }), cfg, fetcher)).status).toBe(415);
    }
    expect((await handleRequest(request(undefined, { body: new Uint8Array() }), cfg, fetcher)).status).toBe(400);
    expect((await handleRequest(request(undefined, { body: new Uint8Array(8 * 1024 * 1024 + 1) }), cfg, fetcher)).status).toBe(413);
    expect(calls).toBe(0);
  });

  test("keeps identity, Host, Origin, method, pathname and JSON-only write boundaries", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return Response.json({ ok: true }); };
    for (const headers of <Record<string, string>[]>[
      { "tailscale-user-login": "" }, { "tailscale-user-login": "other@test" },
      { host: "evil.test" }, { origin: "" }, { origin: "https://evil.test" },
      { origin: `http://${host}` }, { origin: `https://${host}:444` },
    ]) {
      expect((await handleRequest(request(undefined, { headers }), cfg, fetcher)).status).toBeGreaterThanOrEqual(400);
    }
    for (const path of ["/lite/api/stt/extra", "/lite/api/stt?pane=p1", "/lite/api/%73tt", "/lite/api/stt/"]) {
      expect((await handleRequest(request(path), cfg, fetcher)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await handleRequest(request(undefined, { method: "GET", body: null }), cfg, fetcher)).status).toBe(404);
    expect((await handleRequest(request("/lite/api/pane/p1/reply"), cfg, fetcher)).status).toBe(415);
    expect(calls).toBe(0);
  });
  test("forwards raw audio to the exact bridge endpoint, never to a pane", async () => {
    const calls: string[] = [];
    const response = await handleRequest(request(), cfg, async (url, init) => {
      calls.push(String(url));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("audio/webm;codecs=opus");
      expect(new Headers(init?.headers).get("tailscale-user-login")).toBe("me@test");
      expect([...new Uint8Array(await new Response(init?.body).arrayBuffer())]).toEqual([0, 128, 255, 42]);
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
      return Response.json({ ok: true, text: "请继续" });
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, text: "请继续" });
    expect(calls).toEqual(["http://127.0.0.1:8787/api/stt"]);
  });
});
