import { afterEach, expect, test } from "bun:test";
import { getPersonaMemory, putPersonaMemory } from "./persona-memory-api.ts";
import { sessionState } from "./session-state.ts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; sessionState.lock(); });
const memory = { documents: { facts: { content: "Guangzhou", revision: "f" }, preferences: { content: "", revision: "p" }, project: { content: "", revision: "j" } }, effective: "next-session", injection: { strategy: "first-message-prefix", unsupported: true, notice: "unsupported native injection" } };
const document = { kind: "facts" as const, content: "Shenzhen", revision: "f" };

test("production memory reads remain available but locked saves never dispatch", async () => {
  sessionState.lock();
  let gets = 0, writes = 0;
  globalThis.fetch = (async (_input, init) => { if (init?.method === "PUT") writes++; else gets++; return Response.json(memory); }) as typeof fetch;
  expect((await getPersonaMemory("p")).documents.facts.content).toBe("Guangzhou");
  await expect(putPersonaMemory("p", document)).rejects.toMatchObject({ status: 423 });
  expect(gets).toBe(1); expect(writes).toBe(0);
});

test("production saves require catch-up, propagate server lock, and never replay on unlock", async () => {
  sessionState.apply({ locked: false, epoch: 7, generation: "memory-fixture" });
  let writes = 0;
  globalThis.fetch = (async () => { writes++; return Response.json({ ok: false, code: "session.locked" }, { status: 423 }); }) as unknown as typeof fetch;
  await expect(putPersonaMemory("p", document)).rejects.toMatchObject({ status: 423 });
  expect(writes).toBe(0);
  sessionState.caughtUp();
  await expect(putPersonaMemory("p", document)).rejects.toMatchObject({ status: 423 });
  expect(writes).toBe(1); expect(sessionState.get().locked).toBe(true);
  sessionState.apply({ locked: false, epoch: 8, generation: "memory-fixture" }); sessionState.caughtUp();
  await Promise.resolve();
  expect(writes).toBe(1);
});
