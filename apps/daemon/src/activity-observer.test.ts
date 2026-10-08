import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityLedger } from "./activity-ledger.ts";
import { createActivityObserver } from "./activity-observer.ts";
import type { HerdrPort } from "./herdr-client.ts";
import { SessionLock } from "./session-lock.ts";
import { createDaemonSystemAdmissions } from "./system-admission.ts";

test("snapshot failures keep retrying until a subscription acknowledgement restores observation", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-observer-retry-"));
  const ledger = new ActivityLedger(join(root, "activity.json"));
  let attempts = 0;
  const recovered = Promise.withResolvers<void>();
  const herdr: Pick<HerdrPort, "snapshot" | "subscribe"> = {
    async snapshot() { if (++attempts < 3) throw new Error("temporary snapshot refusal"); return { workspaces: [], tabs: [], panes: [], agents: [] }; },
    subscribe(_event, _down, options) { queueMicrotask(() => { options?.onUp?.(); recovered.resolve(); }); return { close() {} }; },
  };
  const observer = createActivityObserver(ledger, herdr, createDaemonSystemAdmissions().activityObserve, { retryMs: 1 });
  try {
    await expect(observer.ready).rejects.toThrow("temporary snapshot refusal");
    await recovered.promise;
    expect(attempts).toBe(3);
    expect((await ledger.list()).observation).toBe("live");
  } finally { observer.close(); await rm(root, { recursive: true, force: true }); }
});

test("one event I/O failure records a gap, recovers the queue and never fabricates a terminal result", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-observer-write-"));
  class FlakyLedger extends ActivityLedger {
    calls = 0;
    override async observe(...args: Parameters<ActivityLedger["observe"]>) { if (++this.calls === 1) throw new Error("temporary write failure"); await super.observe(...args); }
  }
  const ledger = new FlakyLedger(join(root, "activity.json"));
  let event: (name: string, data: unknown) => void = () => {};
  let streams = 0;
  const recovered = Promise.withResolvers<void>();
  const herdr: Pick<HerdrPort, "snapshot" | "subscribe"> = {
    async snapshot() { return { workspaces: [], tabs: [], panes: [{ pane_id: "p", workspace_id: "s", tab_id: "t", cwd: "/" }], agents: [] }; },
    subscribe(onEvent, _down, options) { event = onEvent; streams++; queueMicrotask(() => { options?.onUp?.(); if (streams >= 3) recovered.resolve(); }); return { close() {} }; },
  };
  const observer = createActivityObserver(ledger, herdr, createDaemonSystemAdmissions().activityObserve, { retryMs: 1 });
  try {
    await observer.ready;
    const session = new SessionLock(); const { token } = session.unlock("test");
    await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, session.admission(session.admit(token, "test")));
    await observer.watch("p");
    event("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" });
    await observer.flush();
    expect((await ledger.list()).observation).toBe("gap");
    await recovered.promise;
    event("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" });
    await observer.flush();
    expect(ledger.calls).toBe(2);
    expect((await ledger.ownership("p"))?.status).toBe("unknown");
    expect((await ledger.list()).events.map((e) => e.kind)).toEqual(["task.created", "observation.gap", "task.unknown"]);
  } finally { observer.close(); await rm(root, { recursive: true, force: true }); }
});

test("observer scopes durable ownership, observes live transitions and persists disconnect gaps", async () => {
  const root = await mkdtemp(join(tmpdir(), "homeling-observer-"));
  const ledger = new ActivityLedger(join(root, "activity.json"));
  let event: (name: string, data: unknown) => void = () => {};
  let down: (reason: string) => void = () => {};
  let scoped: readonly string[] = [];
  const herdr: Pick<HerdrPort, "snapshot" | "subscribe"> = {
    async snapshot() { return { workspaces: [], tabs: [], panes: [{ pane_id: "p", workspace_id: "s", tab_id: "t", cwd: "/" }], agents: [] }; },
    subscribe(onEvent, onDown, options) {
      event = onEvent; down = onDown; scoped = options?.paneIds ?? [];
      queueMicrotask(() => options?.onUp?.());
      return { close() {} };
    },
  };
  const observer = createActivityObserver(ledger, herdr, createDaemonSystemAdmissions().activityObserve, { retryMs: 60_000 });
  try {
    await observer.ready;
    const session = new SessionLock(); const { token } = session.unlock("test");
    await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, session.admission(session.admit(token, "test")));
    await observer.watch("p");
    expect(scoped).toEqual(["p"]);
    event("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" });
    event("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" });
    await observer.flush();
    expect((await ledger.list()).events.map((e) => e.kind)).toEqual(["task.created", "task.completed"]);
    const admission = session.admission(session.admit(token, "test"));
    await ledger.register({ personaId: "a", spaceId: "s", paneId: "q", title: "Other" }, admission);
    down("lost stream");
    await observer.flush();
    expect((await ledger.ownership("q"))?.status).toBe("unknown");
    expect((await ledger.list()).observation).toBe("gap");
  } finally { observer.close(); await rm(root, { recursive: true, force: true }); }
});
