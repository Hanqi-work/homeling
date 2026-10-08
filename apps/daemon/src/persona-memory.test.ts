import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaMemoryStore } from "./persona-memory.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "homeling-memory-"));
  roots.push(root);
  return join(root, "memory");
}

test("Markdown facts survive store restart without changing another persona", async () => {
  const root = await fixture();
  const store = new PersonaMemoryStore(root);
  const initial = await store.read("persona-a");
  const saved = await store.save("persona-a", "facts", "# Facts\n我住在广州。\n", initial.documents.facts.revision);
  expect(saved.documents.facts.content).toBe("# Facts\n我住在广州。\n");
  expect((await new PersonaMemoryStore(root).read("persona-a")).documents.facts).toEqual(saved.documents.facts);
  expect((await store.read("persona-b")).documents.facts.content).toBe("");
});
