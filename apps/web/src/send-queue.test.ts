import { describe, expect, test } from "bun:test";
import { createDeferredSendQueue, enqueueUnlessConfirmed } from "./send-queue.ts";
import { SessionStateStore } from "./session-state.ts";
import { historyReducer, initialHistoryState } from "./history-reducer.ts";
import type { TranscriptEntry } from "@homeling/contracts";

async function flushQueue(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("createDeferredSendQueue", () => {
  test("history unblock after locking and unlocking never replays deferred writes from the old epoch", async () => {
    const session = new SessionStateStore();
    session.apply({ locked: false, epoch: 1, generation: "boot" }); session.caughtUp();
    const queue = createDeferredSendQueue(session.admit);
    const writes: string[] = [];
    queue.block("unknown");
    await queue.enqueue("deferred", async () => { writes.push("deferred"); });
    session.lock();
    queue.unblock("unknown");
    await flushQueue();
    session.apply({ locked: false, epoch: 2, generation: "boot" }); session.caughtUp();
    await flushQueue();
    expect(writes).toEqual([]);
    await queue.enqueue("explicit-new-action", async () => { writes.push("new"); });
    expect(writes).toEqual(["new"]);
  });
  test("runs concurrent sends one at a time in enqueue order", async () => {
    const queue = createDeferredSendQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.enqueue("first", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = queue.enqueue("second", async () => { order.push("second:start"); });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("defers already-queued messages until the partial-input retry resolves", async () => {
    const queue = createDeferredSendQueue();
    const order: string[] = [];
    const first = queue.enqueue("A", async () => {
      order.push("A:send");
      queue.block("A");
    });
    const second = queue.enqueue("B", async () => { order.push("B:send"); });
    const retry = queue.enqueue("A", async () => {
      order.push("A:retry");
      queue.unblock("A");
    });

    await Promise.all([first, second, retry]);
    await Promise.resolve();
    expect(order).toEqual(["A:send", "A:retry", "B:send"]);
  });

  test("skips a queued retry if history confirms it before dequeue", async () => {
    const queue = createDeferredSendQueue();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.enqueue("busy", async () => { await gate; });
    let confirmed = false;
    let posts = 0;
    const retry = enqueueUnlessConfirmed(queue, "retry-me", () => confirmed, async () => { posts += 1; });
    confirmed = true;
    releaseFirst();
    await Promise.all([first, retry]);
    expect(posts).toBe(0);
  });

  test("history confirmation releases later sends without requiring a retry click", async () => {
    const paneId = "pane-a";
    const blockerId = "optimistic-a";
    let state = historyReducer(initialHistoryState(paneId), {
      type: "outgoing-added", paneId, id: blockerId, text: "A", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-failed", paneId, id: blockerId, textDelivered: true,
    });
    const queue = createDeferredSendQueue();
    queue.block(blockerId);
    const order: string[] = [];
    await queue.enqueue("optimistic-b", async () => { order.push("B"); });
    await queue.enqueue("optimistic-c", async () => { order.push("C"); });

    state = historyReducer(state, {
      type: "received", paneId, requestId: 1,
      entries: [{ uuid: "history-a", ts: "2026-10-01T00:00:02Z", role: "user", parts: [{ kind: "text", text: "A" }] }],
    });
    expect(state.outgoing[0]?.matchedUuid).toBe("history-a");
    if (state.outgoing[0]?.matchedUuid) queue.unblock(blockerId);
    await flushQueue();
    expect(order).toEqual(["B", "C"]);
  });

  test("history received after retry enqueue cancels the queued duplicate POST", async () => {
    const paneId = "pane-a";
    const id = "optimistic-a";
    const entry: TranscriptEntry = {
      uuid: "history-a", ts: "2026-10-01T00:00:02Z", role: "user", parts: [{ kind: "text", text: "A" }],
    };
    let state = historyReducer(initialHistoryState(paneId), {
      type: "outgoing-added", paneId, id, text: "A", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, { type: "outgoing-failed", paneId, id, textDelivered: null });
    const queue = createDeferredSendQueue();
    queue.block(id);
    let posts = 0;
    const retry = enqueueUnlessConfirmed(queue, id, () => Boolean(state.outgoing[0]?.matchedUuid), async () => { posts += 1; });
    state = historyReducer(state, { type: "outgoing-retry", paneId, id });
    state = historyReducer(state, { type: "received", paneId, requestId: 1, entries: [entry] });
    expect(state.outgoing[0]?.matchedUuid).toBe("history-a");
    await retry;
    expect(posts).toBe(0);
  });

  test("continues after a failed operation", async () => {
    const queue = createDeferredSendQueue();
    const order: string[] = [];
    await expect(queue.enqueue("failed", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await queue.enqueue("next", async () => { order.push("next"); });
    expect(order).toEqual(["next"]);
  });
});
