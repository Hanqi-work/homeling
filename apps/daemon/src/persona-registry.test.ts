import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PersonaRegistry, type Persona } from "./persona-registry.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "homeling-registry-"));
  roots.push(root);
  const path = join(root, "config", "registry.json");
  return { root, path, registry: new PersonaRegistry(path) };
}

function persona(id: string): Persona {
  return {
    id, name: `Persona ${id}`, avatar: { color: "#86efac" }, spaceId: `space-${id}`,
    mainPaneId: `pane-${id}`, systemPrompt: "Be helpful", createdAt: "2026-10-08T00:00:00.000Z",
  };
}

describe("PersonaRegistry", () => {
  test("persists CRUD atomically and restores records after a new registry instance", async () => {
    const { path, registry } = await fixture();
    await Promise.all([registry.createPersona(persona("a")), registry.createPersona(persona("b"))]);
    expect((await registry.list()).map((item) => item.id).sort()).toEqual(["a", "b"]);
    await registry.patchPersona("a", { paused: true });
    expect(await registry.get("a")).toMatchObject({ name: "Persona a", paused: true });

    const content = await readFile(path, "utf8");
    expect(JSON.parse(content).version).toBe(1);
    expect(content.endsWith("\n")).toBe(true);
    expect(await readdir(dirname(path))).toEqual(["registry.json"]);

    const recovered = new PersonaRegistry(path);
    expect(await recovered.get("a")).toMatchObject({ id: "a", spaceId: "space-a" });
    await recovered.removePersona("a", {
      spaceId: "space-a", personaName: "Persona a", archivedAt: "2026-10-08T01:00:00.000Z",
    });
    expect(await recovered.patchPersona("a", { paused: false })).toBeUndefined();
    await recovered.addOrphan({ spaceId: "space-orphan", createdAt: "2026-10-08T02:00:00.000Z", reason: "rollback pending" });

    const restarted = new PersonaRegistry(path);
    expect((await restarted.list()).map((item) => item.id)).toEqual(["b"]);
    const persisted = await restarted.load();
    expect(persisted.archivedSpaces).toHaveLength(1);
    expect(persisted.orphans).toHaveLength(1);
    expect(await readdir(dirname(path))).toEqual(["registry.json"]);
  });
});
