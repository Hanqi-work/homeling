import { afterEach, describe, expect, test } from "bun:test";
import { fetchLaunchers, fetchPaneScreen, launchTask, sendPaneReply, stopPaneTask, transcribeAudio } from "./api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("STT API", () => {
  test("uploads raw recorder bytes with cancellation and returns text without a reply call", async () => {
    const audio = new Blob(["clip"], { type: "audio/mp4" });
    const controller = new AbortController();
    const urls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      expect(init?.body).toBe(audio);
      expect(new Headers(init?.headers).get("content-type")).toBe("audio/mp4");
      expect(init?.signal).toBeDefined();
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return Response.json({ ok: true, text: "请继续" });
    }) as typeof fetch;
    await expect(transcribeAudio(audio, controller.signal)).resolves.toBe("请继续");
    expect(urls).toEqual(["/lite/api/stt"]);
  });
});

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

describe("task detail APIs", () => {
  test("reads the current pane screen over the same-origin daemon API", async () => {
    let url = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      url = String(input);
      return Response.json({ paneId: "w1:p2", text: "screen", truncated: false });
    }) as unknown as typeof fetch;
    await expect(fetchPaneScreen("w1:p2")).resolves.toMatchObject({ text: "screen" });
    expect(url).toBe("/lite/api/pane/w1%3Ap2");
  });

  test("posts a semantic stop request without accepting caller-supplied keys", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? "", body: String(init?.body) });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    await stopPaneTask("w1:p2");
    expect(requests).toEqual([{ url: "/lite/api/pane/w1%3Ap2/stop", method: "POST", body: "{}" }]);
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
