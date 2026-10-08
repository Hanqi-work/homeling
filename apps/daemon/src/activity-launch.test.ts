import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityLedger } from "./activity-ledger.ts";
import { createActivityObserver } from "./activity-observer.ts";
import { daemonConfigFromEnv } from "./config.ts";
import { HerdrRpcError, type HerdrPort, type HerdrPane } from "./herdr-client.ts";
import { PersonaRegistry } from "./persona-registry.ts";
import { launchPersonaTask, type PersonaRuntime } from "./persona-service.ts";
import { SessionLock } from "./session-lock.ts";
import { createDaemonSystemAdmissions } from "./system-admission.ts";

async function fixture(fail = false) {
  const root = await mkdtemp(join(tmpdir(), "homeling-activity-launch-"));
  const cfg = daemonConfigFromEnv({ HOMELING_REGISTRY_PATH: join(root, "registry.json") });
  const activity = new ActivityLedger(join(root, "activity.json"));
  const lock = new SessionLock(); const { token } = lock.unlock("test");
  const admission = lock.admission(lock.admit(token, "test"));
  const registry = new PersonaRegistry(cfg.registryPath);
  await registry.createPersona({ id: "a", name: "A", avatar: { color: "#abcdef" }, spaceId: "s", mainPaneId: "main", systemPrompt: "", createdAt: new Date().toISOString(), launcherCommand: "agent" }, admission);
  const panes: HerdrPane[] = [];
  let running = false; let creates = 0;
  let event: (name: string, data: unknown) => void = () => {};
  const unavailable = async (): Promise<never> => { throw new Error("not needed"); };
  const herdr: HerdrPort = {
    createSpace: unavailable, renameSpace: unavailable,
    async createTab() { creates++; const pane = { pane_id: "p", workspace_id: "s", tab_id: "t", cwd: "/" }; panes.push(pane); return pane; },
    async readPane() { return "$ "; },
    async sendText() {},
    async sendKeys() { if (fail) throw new HerdrRpcError("send_failed", "input rejected"); running = true; event("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }); },
    async closePane() { panes.splice(0); event("pane_closed", { pane_id: "p", workspace_id: "s" }); },
    async snapshot() { return { workspaces: [{ workspace_id: "s", label: "A" }], tabs: [], panes, agents: running ? [{ pane_id: "p", agent_status: "working" }] : [] }; },
    subscribe(onEvent, _onDown, options) { event = onEvent; queueMicrotask(() => options?.onUp?.()); return { close() {} }; },
  };
  const observer = createActivityObserver(activity, herdr, createDaemonSystemAdmissions().activityObserve);
  await observer.ready;
  const runtime: PersonaRuntime = { cfg, registry, activity, herdr, fetcher: async () => Response.json({ launchers: [{ command: "agent", label: "Build" }], home: "/" }), observeTask: (paneId) => observer.watch(paneId) };
  return { root, activity, observer, runtime, admission, lock, token, event: () => event, creates: () => creates };
}

test("guarded user launch registers ownership before agent dispatch and observed completion survives restart", async () => {
  const f = await fixture();
  try {
    const response = await launchPersonaTask(f.runtime, "a", "agent", null, f.admission);
    expect(response.status).toBe(200);
    f.event()("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" });
    await f.observer.flush();
    const retained = await new ActivityLedger(f.activity.path).list("a");
    expect(retained.events.map((event) => event.kind)).toEqual(["task.created", "task.completed"]);
    expect(retained.occurrences[0]).toMatchObject({ personaId: "a", paneId: "p", spaceId: "s", status: "completed" });
  } finally { f.observer.close(); await rm(f.root, { recursive: true, force: true }); }
});

test("explicit launch rejection records one failure and a locked user creates no task", async () => {
  const f = await fixture(true);
  try {
    const response = await launchPersonaTask(f.runtime, "a", "agent", null, f.admission);
    expect(response.status).toBe(502);
    await f.observer.flush();
    expect((await f.activity.list()).events.map((event) => event.kind)).toEqual(["task.created", "task.failed"]);
    f.lock.lock(f.token, "test");
    await expect(launchPersonaTask(f.runtime, "a", "agent", null, f.admission)).rejects.toThrow("session.locked");
    expect(f.creates()).toBe(1);
  } finally { f.observer.close(); await rm(f.root, { recursive: true, force: true }); }
});
