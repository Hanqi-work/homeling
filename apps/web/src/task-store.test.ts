import { describe, expect, test } from "bun:test";
import { mapTaskStatuses, type Task } from "@homeling/contracts";
import type { SnapshotResponse } from "@homeling/contracts";
import { conversationTaskStorageKey, readConversationTasks, saveConversationTasks } from "./task-store.ts";

class MemoryStorage {
  #values = new Map<string, string>();
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

const task: Task = {
  paneId: "w2:p1",
  launcher: { command: "bun test", label: "Test suite", cwd: "/repo" },
  createdAt: 1_760_000_000_000,
  status: "working",
};

const snapshot: SnapshotResponse = {
  bridge: "connected",
  agents: [{ paneId: "w2:p1", workspaceId: "w2", workspaceLabel: "Repo", workspaceNumber: 2, tabId: "w2:t1", agent: "claude", status: "working", cwd: "/repo", focused: false }],
  shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: 1,
};

describe("conversation task session store", () => {
  test("restores a task after leaving and returning, then derives current pane status", () => {
    const storage = new MemoryStorage();
    saveConversationTasks("thread-pane", [task], storage);

    const returnedTasks = readConversationTasks("thread-pane", storage);
    expect(returnedTasks).toEqual([{ ...task, status: "unknown" }]);
    expect(mapTaskStatuses(returnedTasks, snapshot)).toEqual([task]);
  });

  test("keeps persona task chips under a stable owner key after main-pane replacement", () => {
    const storage = new MemoryStorage();
    const oldKey = conversationTaskStorageKey("w1:p1", "persona-1");
    const recoveredKey = conversationTaskStorageKey("w1:p3", "persona-1");
    expect(recoveredKey).toBe(oldKey);
    saveConversationTasks(oldKey, [task], storage);
    expect(readConversationTasks(recoveredKey, storage)).toEqual([{ ...task, status: "unknown" }]);
  });

  test("isolates task metadata by conversation and never persists runtime status", () => {
    const storage = new MemoryStorage();
    saveConversationTasks("thread-one", [task], storage);
    expect(readConversationTasks("thread-two", storage)).toEqual([]);
    expect(storage.getItem("homeling:tasks:thread-one")).not.toContain('"status":"working"');
  });
});
