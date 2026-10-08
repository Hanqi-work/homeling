import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLedger } from "./activity-ledger.ts";
import { SessionLock } from "./session-lock.ts";
import { createDaemonSystemAdmissions } from "./system-admission.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "homeling-activity-")); dirs.push(dir);
  const path = join(dir, "activity.json");
  const lock = new SessionLock();
  const { token } = lock.unlock("test");
  return { path, ledger: new ActivityLedger(path), admission: lock.admission(lock.admit(token, "test")), observer: createDaemonSystemAdmissions().activityObserve, lock, token };
}

test("validated real status transitions complete once, exit without outcome is unknown", async () => {
  const { ledger, admission, observer, path } = await fixture();
  const first = await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  await ledger.observe("pane_exited", { pane_id: "p", workspace_id: "s", exit_code: 1 }, observer);
  expect((await new ActivityLedger(path).list()).events.map((e) => e.kind)).toEqual(["task.created", "task.completed"]);
  expect((await ledger.ownership("p"))?.occurrenceKey).toBe(first.occurrenceKey);
  await ledger.register({ personaId: "a", spaceId: "s", paneId: "q", title: "Other" }, admission);
  await ledger.observe("pane_exited", { pane_id: "q", workspace_id: "s", exit_code: 0 }, observer);
  expect((await ledger.ownership("q"))?.status).toBe("unknown");
  expect((await ledger.list()).events.map((e) => e.kind)).toEqual(["task.created", "task.completed", "task.created", "task.unknown"]);
});

test("restart/disconnect records a gap without inventing completion and repeated work gets one new occurrence", async () => {
  const { ledger, admission, observer, path } = await fixture();
  const first = await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  const second = await ledger.ownership("p");
  expect(second?.occurrenceKey).not.toBe(first.occurrenceKey);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  expect((await ledger.ownership("p"))?.occurrenceKey).toBe(second?.occurrenceKey);
  const restarted = new ActivityLedger(path);
  await restarted.gap("Daemon restart: no upstream replay", observer);
  await restarted.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  expect((await restarted.ownership("p"))?.status).toBe("unknown");
  expect((await restarted.list()).events.map((e) => e.kind)).toEqual(["task.created", "task.completed", "task.created", "observation.gap", "task.unknown"]);
});

test("untrusted payloads cannot attribute or fabricate task history, and terminal outcomes are exclusive", async () => {
  const { ledger, admission, observer } = await fixture();
  const occurrence = await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  expect((await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission)).occurrenceKey).toBe(occurrence.occurrenceKey);
  for (const data of [null, [], { pane_id: "p", workspace_id: "other", agent_status: "done" }, { pane_id: "foreign", workspace_id: "s", agent_status: "done" }, { pane_id: "p", workspace_id: "s", status: "failed" }, { pane_id: "p", workspace_id: "s", agent_status: "done", type: "pane_exited" }]) {
    await ledger.observe("pane_agent_status_changed", data, observer);
  }
  await ledger.observe("pane.agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "idle" }, observer);
  await ledger.observe("pane.agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  expect((await ledger.list()).events.map((e) => e.kind)).toEqual(["task.created"]);
  await ledger.fail(occurrence.occurrenceKey, "Launcher readiness failed", admission);
  await ledger.fail(occurrence.occurrenceKey, "duplicate", admission);
  await ledger.observe("pane.agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  await ledger.observe("pane.agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  expect((await ledger.list()).events.map((e) => e.kind)).toEqual(["task.created", "task.failed"]);
});

test("locking at the actual atomic rename prevents user ownership commits and subscriber delivery", async () => {
  const { ledger, admission, lock, token } = await fixture();
  const events: unknown[] = [];
  ledger.subscribe((event) => events.push(event));
  const racingAdmission = { assert: () => admission.assert(), dispatch<T>(effect: () => T): T { lock.lock(token, "test"); return admission.dispatch(effect); } };
  await expect(ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, racingAdmission)).rejects.toThrow("session.locked");
  expect((await ledger.list()).events).toEqual([]);
  expect(await ledger.ownership("p")).toBeUndefined();
  expect(events).toEqual([]);
});

test("completed work cannot roll over across a gap or a daemon restart", async () => {
  const { ledger, path, observer, admission } = await fixture();
  const occurrence = await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  await ledger.gap("disconnect", observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  expect((await ledger.ownership("p"))?.occurrenceKey).toBe(occurrence.occurrenceKey);
  const restarted = new ActivityLedger(path);
  await restarted.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  expect((await restarted.ownership("p"))?.occurrenceKey).toBe(occurrence.occurrenceKey);
});

test("corrupt persistence fails closed instead of resetting ownership or publishing invented events", async () => {
  const { ledger, path, observer, admission } = await fixture();
  await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  const valid = await readFile(path, "utf8");
  for (const mutate of [
    (state: any) => { state.events[0].personaId = "foreign"; },
    (state: any) => { state.events.push(state.events[0]); },
    (state: any) => { state.occurrences[0].status = "failed"; },
    (state: any) => { state.events[0].sequence = 0; },
    (state: any) => { state.workEpochs = { absent: "epoch" }; },
  ]) {
    const state = JSON.parse(valid); mutate(state); await writeFile(path, JSON.stringify(state));
    const restarted = new ActivityLedger(path);
    await expect(restarted.list()).rejects.toThrow("Invalid activity ledger");
    await expect(restarted.observe("pane_exited", { pane_id: "p", workspace_id: "s" }, observer)).rejects.toThrow("Invalid activity ledger");
  }
});

test("observer capabilities cannot enroll user tasks or report user launch failures", async () => {
  const { ledger, observer } = await fixture();
  await expect(ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, observer)).rejects.toThrow("Task registration requires");
  await expect(ledger.fail("missing", "fake launch failure", observer)).rejects.toThrow("original user admission");
  const wrongScope = createDaemonSystemAdmissions().personaRecovery;
  await expect(ledger.observe("pane_exited", { pane_id: "p", workspace_id: "s" }, wrongScope as unknown as typeof observer)).rejects.toThrow("activity.observe");
});

test("invalid registration cannot commit a ledger its own read seam rejects", async () => {
  const { ledger, admission } = await fixture();
  await expect(ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "" }, admission)).rejects.toThrow("Invalid activity ledger");
  expect((await ledger.list()).events).toEqual([]);
});

test("each real observation gap remains recorded even when the latest task already completed", async () => {
  const { ledger, observer, admission } = await fixture();
  await ledger.register({ personaId: "a", spaceId: "s", paneId: "p", title: "Build" }, admission);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "working" }, observer);
  await ledger.observe("pane_agent_status_changed", { pane_id: "p", workspace_id: "s", agent_status: "done" }, observer);
  await ledger.gap("first disconnect", observer);
  ledger.live(observer);
  await ledger.gap("second disconnect", observer);
  const events = (await ledger.list()).events;
  expect(events.filter((e) => e.kind === "observation.gap").map((e) => e.detail)).toEqual(["first disconnect", "second disconnect"]);
  expect(new Set(events.map((e) => e.dedupeKey)).size).toBe(events.length);
  expect((await ledger.ownership("p"))?.status).toBe("completed");
});

test("task creation commits durable persona ownership before live subscribers are notified", async () => {
  const { ledger, path, admission } = await fixture();
  const delivered: string[] = [];
  ledger.subscribe((event) => delivered.push(event.id));
  const occurrence = await ledger.register({ personaId: "persona-a", spaceId: "space-a", paneId: "pane-a", title: "Build" }, admission);
  const restarted = new ActivityLedger(path);
  expect(await restarted.ownership("pane-a")).toEqual(occurrence);
  const history = await restarted.list("persona-a");
  expect(history.events.map((event) => event.kind)).toEqual(["task.created"]);
  expect(delivered).toEqual([history.events[0]!.id]);
  expect((await restarted.list("persona-b")).events).toEqual([]);
});
