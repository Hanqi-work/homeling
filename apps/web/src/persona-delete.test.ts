import { afterEach, expect, test } from "bun:test";
import { deletePersona } from "./api.ts";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
test("delete preserves partial archive result rather than claiming fully archived", async () => {
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe("/lite/api/persona/mira");
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    return Response.json({ deleted: true, archived: false });
  }) as typeof fetch;
  await expect(deletePersona("mira")).resolves.toEqual({ deleted: true, archived: false });
});
