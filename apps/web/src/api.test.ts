import { afterEach, describe, expect, test } from "bun:test";
import { fetchLaunchers, launchTask, sendPaneReply } from "./api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("task launch API", () => {
  test("reads launcher rows and posts only the selected allowlist command", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() });
      return init?.method === "POST"
        ? Response.json({ ok: true, pane: { paneId: "w2:p1", workspaceId: "w2", workspaceLabel: "Repo", tabId: "w2:t1", cwd: "/repo" } })
        : Response.json({ launchers: [{ command: "bun test", label: "Test", cwd: "/repo" }], home: "/home/test" });
    }) as unknown as typeof fetch;

    const launchers = await fetchLaunchers();
    const result = await launchTask(launchers.launchers[0]!, "w1:p2");
    expect(requests).toEqual([
      { url: "/lite/api/launchers", method: "GET", body: undefined },
      { url: "/lite/api/launch", method: "POST", body: '{"command":"bun test","paneId":"w1:p2"}' },
    ]);
    expect(result.pane.paneId).toBe("w2:p1");
  });

  test("surfaces bridge allowlist failure rather than reporting a task", async () => {
    globalThis.fetch = (async () => Response.json(
      { ok: false, error: "Command is not allowlisted", code: "launch.not_allowlisted" },
      { status: 400 },
    )) as unknown as typeof fetch;
    await expect(launchTask({ command: "not allowed", label: "No" })).rejects.toMatchObject({
      message: "Command is not allowlisted",
      code: "launch.not_allowlisted",
    });
  });
});

describe("sendPaneReply", () => {
  test("posts Collie's reply request shape and accepts its ActionResponse", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "", body: String(init?.body) });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    await sendPaneReply("w1:p2", "hello");
    expect(requests).toEqual([{
      url: "/lite/api/pane/w1%3Ap2/reply", method: "POST", body: '{"text":"hello","submit":true}',
    }]);
  });

  test("treats a definite daemon-side 403 as not delivered", async () => {
    globalThis.fetch = (async () => new Response("cross-origin rejected", { status: 403 })) as unknown as typeof fetch;
    await expect(sendPaneReply("p1", "hello")).rejects.toMatchObject({ textDelivered: false });
  });

  test("preserves Collie's partial text delivery signal for safe retry", async () => {
    globalThis.fetch = (async () => Response.json(
      { ok: false, error: "submit failed", textDelivered: true }, { status: 502 },
    )) as unknown as typeof fetch;
    await expect(sendPaneReply("p1", "hello")).rejects.toMatchObject({ textDelivered: true });
  });
});
