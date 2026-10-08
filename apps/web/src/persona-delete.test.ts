import { afterEach, beforeEach, expect, test } from "bun:test";
import { deletePersona } from "./api.ts";
import { sessionState } from "./session-state.ts";
beforeEach(() => { sessionState.apply({ locked: false, epoch: 1, generation: "delete-fixture" }); sessionState.caughtUp(); });
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; sessionState.lock(); });
test("delete preserves partial archive result rather than claiming fully archived", async () => {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("/lite/api/persona/mira");
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    return Response.json({ deleted: true, archived: false });
  }) as unknown as typeof fetch;
  await expect(deletePersona("mira")).resolves.toEqual({ deleted: true, archived: false });
});
test("locked deletion is explicitly not dispatched and never mistaken for success", async () => {
  globalThis.fetch = (async () => Response.json({ error: "Session locked", executed: false, deliveryUnknown: false }, { status: 423 })) as unknown as typeof fetch;
  await expect(deletePersona("mira")).rejects.toMatchObject({ notDispatched: true });
});
