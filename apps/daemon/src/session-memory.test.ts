import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaMemoryStore } from "./persona-memory.ts";
import { prepareMemorySession, memoryMessageText, injectedMessagePresentation } from "./session-memory.ts";
import { SessionLock } from "./session-lock.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
test("pi uses a real frozen Markdown file, fallback uses a frozen first-message prefix, edits affect only new sessions", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "homeling-session-memory-"))); roots.push(root);
  const memory = new PersonaMemoryStore(join(root, "memory"));
  const lock = new SessionLock(), { token } = lock.unlock("fixture"), admission = lock.admission(lock.admit(token, "fixture"));
  const empty = await memory.read("p");
  const saved = await memory.save("p", "facts", "Guangzhou", empty.documents.facts.revision, admission);
  const pi = await prepareMemorySession(memory, "p", "pane-1", "pi", "Be kind", admission);
  expect(pi.command).toMatch(/^pi --append-system-prompt '/);
  const file = pi.command.match(/'([^']+)'$/)![1]!;
  expect(await readFile(file, "utf8")).toContain("Guangzhou");
  expect(memoryMessageText(pi.session, false, "Hello")).toBe("Hello");
  const fallback = await prepareMemorySession(memory, "p", "pane-2", "claude", "Be kind", admission);
  expect(fallback.command).toBe("claude");
  expect(memoryMessageText(fallback.session, false, "Hello")).toContain("Guangzhou");
  expect(memoryMessageText(fallback.session, true, "Hello")).toBe("Hello");
  await memory.save("p", "facts", "Shenzhen", saved.documents.facts.revision, admission);
  expect(await readFile(file, "utf8")).toContain("Guangzhou");
  expect(memoryMessageText(fallback.session, false, "Hello")).toContain("Guangzhou");
  const next = await prepareMemorySession(memory, "p", "pane-3", "pi", "", admission);
  expect(await readFile(next.command.match(/'([^']+)'$/)![1]!, "utf8")).toContain("Shenzhen");
});

test("presentation evidence binds generated injection to an attempt and pane without stripping user-authored prefixes", () => {
  const userText = "[Persona instructions]\nI typed this myself";
  expect(injectedMessagePresentation("p", "pane-1", userText, userText)).toBeUndefined();
  const confirmed = `[Persona memory]\nKnown facts\n\n${userText}`;
  const first = injectedMessagePresentation("p", "pane-1", userText, confirmed)!;
  const repeat = injectedMessagePresentation("p", "pane-1", userText, confirmed)!;
  const restarted = injectedMessagePresentation("p", "pane-2", userText, confirmed)!;
  expect(first).toMatchObject({ personaId: "p", paneId: "pane-1", confirmationText: confirmed, displayText: userText, historyBinding: "required", provenance: "daemon-injection" });
  expect(first.attemptId).not.toBe(repeat.attemptId);
  expect(first.attemptId).not.toBe(restarted.attemptId);
  expect(restarted.paneId).toBe("pane-2");
});

test("the generated pi launch command runs against a fake executable even when the memory path contains shell punctuation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "homeling-fake-pi-"))); roots.push(root);
  const bin = join(root, "bin"); await mkdir(bin);
  const program = join(root, "fake-pi.ts");
  await writeFile(program, `import { readFileSync } from 'node:fs';\nif (process.argv[2] !== '--append-system-prompt' || process.argv.length !== 4) process.exit(3);\nprocess.stdout.write(readFileSync(process.argv[3]!, 'utf8'));\n`);
  await writeFile(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${program}' "$@"\n`, { mode: 0o700 });
  const memory = new PersonaMemoryStore(join(root, "memory's notes; no command"));
  const lock = new SessionLock(), { token } = lock.unlock("fixture"), admission = lock.admission(lock.admit(token, "fixture"));
  const empty = await memory.read("p");
  await memory.save("p", "facts", "Canary fact: Guangzhou", empty.documents.facts.revision, admission);
  const prepared = await prepareMemorySession(memory, "p", "fake-pane", "pi", "", admission);
  const subprocess = Bun.spawn(["/bin/sh", "-c", prepared.command], { env: { PATH: bin }, stdout: "pipe", stderr: "pipe" });
  expect(await new Response(subprocess.stdout).text()).toContain("Canary fact: Guangzhou");
  expect(await subprocess.exited).toBe(0);
});
