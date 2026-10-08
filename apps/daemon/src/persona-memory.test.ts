import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaMemoryStore } from "./persona-memory.ts";
import { SessionLock } from "./session-lock.ts";
function admission() {
  const lock = new SessionLock();
  const { token } = lock.unlock("fixture");
  return lock.admission(lock.admit(token, "fixture"));
}

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "homeling-memory-")));
  roots.push(root);
  return join(root, "memory");
}

test("Markdown facts survive store restart without changing another persona", async () => {
  const root = await fixture();
  const store = new PersonaMemoryStore(root);
  const initial = await store.read("persona-a");
  const saved = await store.save("persona-a", "facts", "# Facts\n我住在广州。\n", initial.documents.facts.revision, admission());
  expect(saved.documents.facts.content).toBe("# Facts\n我住在广州。\n");
  expect((await new PersonaMemoryStore(root).read("persona-a")).documents.facts).toEqual(saved.documents.facts);
  expect((await store.read("persona-b")).documents.facts.content).toBe("");
});

test("concurrent editors cannot silently overwrite a document and disjoint files remain intact", async () => {
  const root = await fixture();
  const a = new PersonaMemoryStore(root), b = new PersonaMemoryStore(root);
  const revision = (await a.read("p")).documents.facts.revision;
  const results = await Promise.allSettled([
    a.save("p", "facts", "First editor", revision, admission()),
    b.save("p", "facts", "Other editor", revision, admission()),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "memory.conflict" } });
  await b.save("p", "preferences", "Short replies", revision, admission());
  expect((await a.read("p")).documents).toMatchObject({ facts: { content: "First editor" }, preferences: { content: "Short replies" } });
});

test("traversal, symlinks, oversized text and invalid Unicode are refused without replacing facts", async () => {
  const root = await fixture(), store = new PersonaMemoryStore(root);
  const revision = (await store.read("p")).documents.facts.revision;
  await store.save("p", "facts", "Keep this", revision, admission());
  await expect(store.read("../other")).rejects.toMatchObject({ code: "memory.unsafe" });
  await expect(store.save("p", "facts", "中".repeat(8001), revision, admission())).rejects.toMatchObject({ status: 413 });
  await expect(store.save("p", "facts", "\ud800", revision, admission())).rejects.toMatchObject({ code: "memory.unsafe" });
  await expect(store.save("p", "../../other" as never, "bad", revision, admission())).rejects.toMatchObject({ code: "memory.unsafe" });
  expect((await store.read("p")).documents.facts.content).toBe("Keep this");
  const target = join(root, "outside.md");
  await writeFile(target, "untouched", { mode: 0o600 });
  await symlink(target, join(root, "p", "project.md"));
  await expect(store.read("p")).rejects.toMatchObject({ code: "memory.unsafe" });
  expect(await readFile(target, "utf8")).toBe("untouched");
});

test("invalid UTF-8 and broad file permissions fail closed", async () => {
  const root = await fixture(), store = new PersonaMemoryStore(root);
  await mkdir(join(root, "p"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "p", "facts.md"), Buffer.from([0xc3, 0x28]), { mode: 0o600 });
  await expect(store.read("p")).rejects.toMatchObject({ code: "memory.unsafe" });
  await rm(join(root, "p", "facts.md"));
  await writeFile(join(root, "p", "facts.md"), "private", { mode: 0o644 });
  await expect(store.read("p")).rejects.toMatchObject({ code: "memory.unsafe" });
});

test("a damaged sibling document prevents committing a save and frozen prompts reject invalid text", async () => {
  const root = await fixture(), store = new PersonaMemoryStore(root);
  const revision = (await store.read("p")).documents.facts.revision;
  const saved = await store.save("p", "facts", "original", revision, admission());
  await writeFile(join(root, "p", "project.md"), Buffer.from([0xc3, 0x28]), { mode: 0o600 });
  await expect(store.save("p", "facts", "changed", saved.documents.facts.revision, admission())).rejects.toMatchObject({ code: "memory.unsafe" });
  await rm(join(root, "p", "project.md"));
  expect((await store.read("p")).documents.facts.content).toBe("original");
  await expect(store.freeze("p", "bad\ud800", admission())).rejects.toMatchObject({ code: "memory.unsafe" });
  await expect(store.freeze("p", "bad\0", admission())).rejects.toMatchObject({ code: "memory.unsafe" });
});

test("a locked save and a lease expiring at the atomic commit do not change memory", async () => {
  const root = await fixture(), store = new PersonaMemoryStore(root);
  const revision = (await store.read("p")).documents.facts.revision;
  const lock = new SessionLock();
  const { token } = lock.unlock("fixture");
  const actor = lock.admit(token, "fixture"), guard = lock.admission(actor);
  lock.lock(token, "fixture");
  await expect(store.save("p", "facts", "refused", revision, guard)).rejects.toThrow("session.locked");
  expect(existsSync(root)).toBe(false);
  await store.save("p", "facts", "original", revision, admission());
  const current = (await store.read("p")).documents.facts.revision;
  let checks = 0;
  const race = {
    assert() {},
    dispatch<T>(effect: () => T): T { if (++checks === 4) throw new Error("session.locked"); return effect(); },
  };
  await expect(store.save("p", "facts", "late overwrite", current, race)).rejects.toThrow("session.locked");
  expect((await store.read("p")).documents.facts.content).toBe("original");
});
