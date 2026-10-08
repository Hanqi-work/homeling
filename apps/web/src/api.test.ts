import { afterEach, describe, expect, test } from "bun:test";
import { sendPaneReply } from "./api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

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
