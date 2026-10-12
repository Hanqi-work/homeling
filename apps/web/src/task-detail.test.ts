import { describe, expect, test } from "bun:test";
import { historyReducer, initialHistoryState } from "./history-reducer.ts";
import { createTaskSendQueue, enqueueTaskSend, stopControlState, taskAvailability, taskRuntimeMinutes } from "./task-detail.ts";

describe("task detail projection", () => {
  test("counts active time from task start and clamps negative duration", () => {
    expect(taskRuntimeMinutes(10_000, 190_000)).toBe(3);
    expect(taskRuntimeMinutes(200_000, 190_000)).toBe(0);
  });

  test("freezes completed duration at the terminal timestamp", () => {
    expect(taskRuntimeMinutes(10_000, 1_000_000, 190_000)).toBe(3);
    expect(taskRuntimeMinutes(10_000, 190_000)).toBe(3);
  });

  test("distinguishes finished, missing, and loading panes", () => {
    expect(taskAvailability("done", true, true)).toBe("finished");
    expect(taskAvailability("working", false, true)).toBe("unavailable");
    expect(taskAvailability(undefined, false, false)).toBe("checking");
    expect(taskAvailability("blocked", true, true)).toBe("active");
  });

  test("allows another stop when the authoritative snapshot still says working", () => {
    const acknowledged = true;
    const afterStopSnapshot = stopControlState("working", true, true, acknowledged);
    expect(afterStopSnapshot).toEqual({ canStop: true, stillActiveAfterInterrupt: true });
    expect(stopControlState("done", true, true, acknowledged)).toEqual({ canStop: false, stillActiveAfterInterrupt: false });
  });

  test("holds B behind A's partial text until explicit retry succeeds, without faking delivery", async () => {
    const queue = createTaskSendQueue(() => () => {});
    const bridgeCalls: string[] = [];
    let inputBuffer = "";
    let historyAvailable = false;
    let releaseNewMessage!: () => void;
    const newMessageSent = new Promise<void>((resolve) => { releaseNewMessage = resolve; });

    await expect(enqueueTaskSend(queue, "A", () => false, async () => {
      inputBuffer += "A";
      bridgeCalls.push("type A", "submit A failed");
      throw new Error("submit failed after text entered");
    }).catch((error: unknown) => {
      queue.block("A");
      throw error;
    })).rejects.toThrow("submit failed after text entered");
    expect(queue.isBlocked()).toBe(true);

    await enqueueTaskSend(queue, "B", () => false, async () => {
      inputBuffer += "B";
      bridgeCalls.push("type B");
      releaseNewMessage();
    });
    expect(bridgeCalls).toEqual(["type A", "submit A failed"]);
    expect(inputBuffer).toBe("A");

    await enqueueTaskSend(queue, "A", () => false, async () => {
      bridgeCalls.push("submit A retry");
      inputBuffer = "";
      queue.unblock("A");
    });
    await newMessageSent;
    expect(bridgeCalls).toEqual(["type A", "submit A failed", "submit A retry", "type B"]);
    expect(inputBuffer).toBe("B");
    expect(historyAvailable).toBe(false);
    expect(queue.isBlocked()).toBe(false);
  });

  test("history confirmation also releases an unknown-delivery queue lock", async () => {
    const queue = createTaskSendQueue(() => () => {});
    await expect(enqueueTaskSend(queue, "unknown-A", () => false, async () => {
      throw new Error("delivery unknown");
    }).catch((error: unknown) => { queue.block("unknown-A"); throw error; })).rejects.toThrow("delivery unknown");
    expect(queue.isBlocked()).toBe(true);
    queue.unblock("unknown-A");
    expect(queue.isBlocked()).toBe(false);
    let delivered = false;
    await enqueueTaskSend(queue, "next", () => false, async () => { delivered = true; });
    expect(delivered).toBe(true);
  });

  test("retry success without transcript confirmation does not mark an unknown message delivered", () => {
    let state = initialHistoryState("pane-1");
    state = historyReducer(state, { type: "outgoing-added", paneId: "pane-1", id: "message-1", text: "work", sentAt: 1_000, attemptOrder: 1 });
    state = historyReducer(state, { type: "outgoing-failed", paneId: "pane-1", id: "message-1", textDelivered: null });
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-1", id: "message-1" });
    state = historyReducer(state, { type: "outgoing-attempt-started", paneId: "pane-1", id: "message-1", attemptOrder: 2 });
    expect(state.outgoing[0]).toMatchObject({ status: "pending", deliveryUnknown: true });
    expect(state.outgoing[0]?.matchedUuid).toBeUndefined();
  });
});
