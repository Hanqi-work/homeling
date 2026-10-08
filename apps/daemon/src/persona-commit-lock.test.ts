import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersonaRegistry } from "./persona-registry.ts";
import { SessionLock } from "./session-lock.ts";
test("locking during an asynchronous registry write prevents the actual persona commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-commit-"));
  try {
    const registry = new PersonaRegistry(join(root, "registry.json"));
    const lock = new SessionLock(); const session = lock.unlock("alice");
    const admission = lock.admission(lock.admit(session.token, "alice"));
    const creating = registry.createPersona({ id: "p1", name: "Mira", avatar: { color: "#86efac" }, spaceId: "s1", mainPaneId: "pane1", systemPrompt: "", launcherCommand: "fake", createdAt: "2026-10-09T00:00:00Z" }, admission);
    lock.lock(session.token, "alice");
    await expect(creating).rejects.toThrow("session.locked");
    expect(await registry.list()).toEqual([]);
    expect(await new PersonaRegistry(registry.path).list()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
