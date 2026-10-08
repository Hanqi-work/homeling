import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityLedger } from "./activity-ledger.ts";
import { createActivityObserver } from "./activity-observer.ts";
import type { HerdrPort } from "./herdr-client.ts";
import { SessionLock } from "./session-lock.ts";
import { createDaemonSystemAdmissions } from "./system-admission.ts";

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
