import { describe, expect, test } from "bun:test";
import { handleRequest } from "./index.ts";
import type { BridgeFetch } from "./bridge-proxy.ts";
import { daemonConfigFromEnv } from "./config.ts";

const permissionScreen = `Bash command\n\n  rm -rf build\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend`;

function request(path: string, options: { method?: string; body?: string; contentType?: string; origin?: string; remoteAddress?: string; login?: string } = {}) {
  const headers = new Headers({ host: "localhost:8790" });
  if (options.login) headers.set("tailscale-user-login", options.login);
  if (options.contentType) headers.set("content-type", options.contentType);
  if (options.origin) headers.set("origin", options.origin);
  return Object.assign(new Request(`http://localhost:8790${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  }), { remoteAddress: options.remoteAddress ?? "127.0.0.1" });
}

function cfg() {
  return { ...daemonConfigFromEnv({}), bridgeOrigin: "http://127.0.0.1:8787" };
}

describe("pending request daemon routes", () => {
  test("GET /lite/api/requests extracts a blocked pane's real terminal prompt", async () => {
    const forwardedLogins: Array<string | null> = [];
    const fetcher: BridgeFetch = async (input, init) => {
      forwardedLogins.push(new Headers(init?.headers).get("tailscale-user-login"));
      const url = String(input);
      if (url.endsWith("/api/snapshot")) return Response.json({
        bridge: "connected", agents: [{
          paneId: "w1:p1", workspaceId: "w1", workspaceLabel: "Work", workspaceNumber: 1,
          tabId: "w1:t1", agent: "claude", status: "blocked", cwd: "/work", focused: true,
        }], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: Date.now(),
      });
      if (url.endsWith("/api/pane/w1:p1")) return Response.json({ paneId: "w1:p1", text: permissionScreen, revision: 12 });
      throw new Error(`unexpected bridge route ${url}`);
    };
    const response = await handleRequest(request("/lite/api/requests", { login: "me@github.com" }), cfg(), fetcher);
    expect(response.status).toBe(200);
    expect(forwardedLogins).toEqual(["me@github.com", "me@github.com"]);
    const requests = await response.json() as Array<Record<string, unknown>>;
    expect(requests[0]).toMatchObject({
      paneId: "w1:p1", personaId: "w1", kind: "prompt-select", status: "pending",
      payload: { question: "Do you want to proceed?" },
    });
    const firstOption = (requests[0]?.payload as { options: Array<Record<string, unknown>> }).options[0]!;
    expect(firstOption).toMatchObject({ id: "1", label: "Yes" });
    expect(firstOption).not.toHaveProperty("keys");
  });

  test("approval rejects cross-origin and non-JSON calls before bridge writes", async () => {
    const config = cfg();
    let writes = 0;
    const fetcher: BridgeFetch = async () => { writes++; return Response.json({ ok: true }); };
    const response = await handleRequest(request("/lite/api/requests/not-a-real-id/approve", {
      method: "POST", contentType: "text/plain", body: '{"optionId":"1"}', origin: "https://evil.example",
    }), config, fetcher);
    expect(response.status).toBe(403);
    expect(writes).toBe(0);

    const wrongType = await handleRequest(request("/lite/api/requests/not-a-real-id/approve", {
      method: "POST", contentType: "text/plain", body: '{"optionId":"1"}',
    }), config, fetcher);
    expect(wrongType.status).toBe(415);
    expect(writes).toBe(0);
  });

  test("POST approval revalidates then forwards guarded keys and resolves the request", async () => {
    const config = cfg();
    let screen = permissionScreen;
    const bridgeWrites: Array<{ url: string; body: Record<string, unknown>; login: string | null }> = [];
    const fetcher: BridgeFetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        bridgeWrites.push({
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          login: new Headers(init.headers).get("tailscale-user-login"),
        });
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/snapshot")) return Response.json({
        bridge: "connected", agents: [{
          paneId: "w1:p1", workspaceId: "w1", workspaceLabel: "Work", workspaceNumber: 1,
          tabId: "w1:t1", agent: "claude", status: "blocked", cwd: "/work", focused: true,
        }], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: Date.now(),
      });
      if (url.endsWith("/api/pane/w1:p1")) return Response.json({ text: screen });
      throw new Error(`unexpected bridge route ${url}`);
    };
    const pending = await handleRequest(request("/lite/api/requests", { login: "me@github.com" }), config, fetcher);
    const [item] = await pending.json() as Array<{ id: string }>;
    const approved = await handleRequest(request(`/lite/api/requests/${encodeURIComponent(item!.id)}/approve`, {
      method: "POST", contentType: "application/json", body: '{"optionId":"1"}', login: "me@github.com",
    }), config, fetcher);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "resolved", outcome: "submitted" });
    expect(bridgeWrites).toHaveLength(1);
    expect(bridgeWrites[0]?.url).toContain("/api/pane/w1:p1/keys");
    expect(bridgeWrites[0]?.body.keys).toEqual(["1"]);
    expect(bridgeWrites[0]?.login).toBe("me@github.com");
  });
});
