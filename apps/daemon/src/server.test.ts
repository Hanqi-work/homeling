import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { handleRequest } from "./index.ts";
import type { BridgeFetch } from "./bridge-proxy.ts";

const ROOT = join(import.meta.dir, ".tmp-server-fixture");
const TAILSCALE_HOST = "rolexdemacbook-air.tail616cc1.ts.net";

const CFG = {
  port: 8790,
  hostname: "127.0.0.1",
  webDist: ROOT,
  indexHtml: "index.html",
  trustedUsers: ["me@github.com"] as readonly string[],
  tailscaleHost: TAILSCALE_HOST,
  allowAnyHost: false,
  bridgeOrigin: "http://127.0.0.1:8787",
};

function req(opts: {
  remoteAddress?: string;
  host?: string;
  login?: string;
  path?: string;
  method?: string;
}): Request & { remoteAddress?: string | null } {
  const headers = new Headers();
  if (opts.host !== undefined) headers.set("host", opts.host);
  if (opts.login !== undefined) headers.set("tailscale-user-login", opts.login);
  return Object.assign(
    new Request(`https://placeholder${opts.path ?? "/lite/"}`, { method: opts.method ?? "GET", headers }),
    { remoteAddress: opts.remoteAddress },
  );
}

beforeAll(async () => {
  await mkdir(ROOT, { recursive: true });
  await writeFile(join(ROOT, "index.html"), "<html>lite-shell</html>");
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("handleRequest — routing", () => {
  test("GET /lite/api/health returns ok for a loopback caller", async () => {
    const res = await handleRequest(req({ remoteAddress: "127.0.0.1", host: "localhost:8790", path: "/lite/api/health" }), CFG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "homeling-daemon" });
  });

  test("proxies the full /lite/api path to the allowlisted bridge history route", async () => {
    let target = "";
    const forwardedLogins: Array<string | null> = [];
    const fetcher: BridgeFetch = async (input, init) => {
      target = String(input);
      forwardedLogins.push(new Headers(init?.headers).get("tailscale-user-login"));
      return Response.json({ available: true, entries: [] }, { headers: { etag: "\"history-1\"" } });
    };
    const response = await handleRequest(
      req({ remoteAddress: "127.0.0.1", host: "localhost:8790", login: "me@github.com", path: "/lite/api/pane/w1:p2/history?limit=30" }),
      CFG,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(target).toBe("http://127.0.0.1:8787/api/pane/w1:p2/history?limit=30");
    expect(forwardedLogins).toEqual(["me@github.com"]);
    expect(response.headers.get("etag")).toBe("\"history-1\"");
  });

  test("proxy rejects writes and paths outside the narrow read allowlist", async () => {
    let calls = 0;
    const fetcher: BridgeFetch = async () => { calls += 1; return Response.json({}); };
    const base = { remoteAddress: "127.0.0.1", host: "localhost:8790" };
    const write = await handleRequest(req({ ...base, path: "/lite/api/snapshot", method: "POST" }), CFG, fetcher);
    const forbidden = await handleRequest(req({ ...base, path: "/lite/api/pane/p1/reply" }), CFG, fetcher);
    expect(write.status).toBe(405);
    expect(forbidden.status).toBe(404);
    expect(calls).toBe(0);
  });

  test("GET /lite/ serves the SPA index", async () => {
    const res = await handleRequest(req({ remoteAddress: "127.0.0.1", host: "localhost:8790", path: "/lite/" }), CFG);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>lite-shell</html>");
  });

  test("deep link /lite/personas/1 falls back to the SPA index", async () => {
    const res = await handleRequest(req({ remoteAddress: "127.0.0.1", host: "localhost:8790", path: "/lite/personas/1" }), CFG);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>lite-shell</html>");
  });

  test("unauthenticated non-loopback /lite/ is rejected with 401 (fail-closed)", async () => {
    const res = await handleRequest(
      req({ remoteAddress: "100.64.0.9", host: `${TAILSCALE_HOST}:443`, path: "/lite/" }),
      CFG,
    );
    expect(res.status).toBe(401);
  });

  test("unauthenticated non-loopback health is also rejected (no anonymous probe)", async () => {
    const res = await handleRequest(
      req({ remoteAddress: "100.64.0.9", host: `${TAILSCALE_HOST}:443`, path: "/lite/api/health" }),
      CFG,
    );
    expect(res.status).toBe(401);
  });

  test("trusted identity can fetch /lite/ over the tailscale host", async () => {
    const res = await handleRequest(
      req({ remoteAddress: "100.64.0.9", host: `${TAILSCALE_HOST}:443`, login: "me@github.com", path: "/lite/" }),
      CFG,
    );
    expect(res.status).toBe(200);
  });
});
