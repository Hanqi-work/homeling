import { describe, expect, test } from "bun:test";
import { mapTaskStatuses, type Task } from "./tasks.ts";
import type { SnapshotResponse } from "./snapshot.ts";

const task: Task = {
  paneId: "w2:p7",
  launcher: { command: "bun test", label: "Test", cwd: "/repo" },
  createdAt: 1_760_000_000_000,
  status: "unknown",
};

const snapshot: SnapshotResponse = {
  bridge: "connected",
  agents: [
    { paneId: "w2:p7", workspaceId: "w2", workspaceLabel: "Repo", workspaceNumber: 2, tabId: "w2:t1", agent: "claude", status: "working", cwd: "/repo", focused: false },
    { paneId: "w2:p8", workspaceId: "w2", workspaceLabel: "Repo", workspaceNumber: 2, tabId: "w2:t1", agent: "codex", status: "blocked", cwd: "/repo", focused: false },
  ],
  shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: 1,
};

describe("task identity and snapshot status", () => {
  test("uses the created pane id as stable identity and launcher metadata", () => {
    expect(task).toEqual({
      paneId: "w2:p7",
      launcher: { command: "bun test", label: "Test", cwd: "/repo" },
      createdAt: 1_760_000_000_000,
      status: "unknown",
    });
  });

  test("maps task status from the matching snapshot pane and preserves task identity", () => {
    expect(mapTaskStatuses([task], snapshot)).toEqual([{ ...task, status: "working" }]);
  });

  test("maps blocked, settled, and absent task panes without changing ids", () => {
    const tasks: Task[] = [
      task,
      { ...task, paneId: "w2:p8" },
      { ...task, paneId: "w2:p9" },
    ];
    expect(mapTaskStatuses(tasks, snapshot).map(({ paneId, status }) => [paneId, status])).toEqual([
      ["w2:p7", "working"],
      ["w2:p8", "blocked"],
      ["w2:p9", "unknown"],
    ]);
    expect(mapTaskStatuses([{ ...task, paneId: "w2:p10" }], {
      ...snapshot,
      agents: [{ ...snapshot.agents[0]!, paneId: "w2:p10", status: "idle" }],
    })[0]?.status).toBe("idle");
  });
});
