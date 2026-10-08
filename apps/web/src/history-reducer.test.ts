import { describe, expect, test } from "bun:test";
import { historyReducer, initialHistoryState, optimisticEntries, type HistoryState } from "./history-reducer.ts";
import type { TranscriptEntry } from "@homeling/contracts";

const entry = (uuid: string, ts: string, text: string, role: TranscriptEntry["role"] = "assistant"): TranscriptEntry => ({
  uuid,
  ts,
  role,
  parts: [{ kind: "text", text }],
});

const stateForPane = (paneId: string): HistoryState => initialHistoryState(paneId);

describe("historyReducer", () => {
  test("merges overlapping polls by UUID, immutably replaces updates, and sorts by timestamp", () => {
    let state = stateForPane("pane-a");
    state = historyReducer(state, { type: "received", paneId: "pane-a", requestId: 1, entries: [
      entry("b", "2026-10-01T00:00:02Z", "second"),
      entry("a", "2026-10-01T00:00:01Z", "first"),
    ] });
    const original = state.entries;
    state = historyReducer(state, { type: "received", paneId: "pane-a", requestId: 2, entries: [
      entry("b", "2026-10-01T00:00:02Z", "updated"),
      entry("c", "2026-10-01T00:00:03Z", "third"),
    ] });

    expect(state.entries.map((item) => item.uuid)).toEqual(["a", "b", "c"]);
    expect(state.entries[1]?.parts).toEqual([{ kind: "text", text: "updated" }]);
    expect(state.entries).not.toBe(original);
  });

  test("merges novel messages from an out-of-order response but drops fully stale duplicates", () => {
    let state = historyReducer(stateForPane("pane-a"), { type: "started", paneId: "pane-a", requestId: 1 });
    state = historyReducer(state, { type: "started", paneId: "pane-a", requestId: 2 });
    const lateFirst = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [entry("first", "", "valid slow result")],
    });
    const fullyStale = historyReducer(lateFirst, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [entry("first", "", "stale overwrite")],
    });

    expect(lateFirst.entries.map((item) => item.uuid)).toEqual(["first"]);
    expect(lateFirst.entries[0]?.parts).toEqual([{ kind: "text", text: "valid slow result" }]);
    expect(lateFirst.requestId).toBe(2);
    expect(fullyStale).toBe(lateFirst);
    expect(historyReducer(lateFirst, {
      type: "received", paneId: "pane-b", requestId: 3, entries: [entry("other", "", "other pane")],
    })).toBe(lateFirst);
  });

  test("unavailable or disconnected reads do not clear already rendered history", () => {
    const current = historyReducer(stateForPane("pane-a"), {
      type: "received", paneId: "pane-a", requestId: 1, entries: [entry("kept", "", "visible")],
    });
    const unavailable = historyReducer(current, {
      type: "unavailable", paneId: "pane-a", requestId: 2,
    });

    expect(unavailable.entries.map((item) => item.uuid)).toEqual(["kept"]);
    expect(unavailable.available).toBe(false);
  });

  test("older pages prepend undated entries and advance their own cursor", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("tail", "", "tail")], hasMore: true, fileTruncated: false,
    });
    expect(state.beforeCursor).toBe("tail");
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2,
      entries: [entry("older", "", "older")], pageKind: "older", hasMore: true,
    });
    expect(state.entries.map((item) => item.uuid)).toEqual(["older", "tail"]);
    expect(state.beforeCursor).toBe("older");

    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 3,
      entries: [entry("oldest", "", "oldest")], pageKind: "older", hasMore: false,
    });
    expect(state.entries.map((item) => item.uuid)).toEqual(["oldest", "older", "tail"]);
    expect(state.beforeCursor).toBeNull();
    expect(state.hasMore).toBe(false);
  });

  test("tail refreshes cannot reopen an exhausted older-page cursor", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("tail", "", "tail")], hasMore: true,
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2,
      entries: [entry("oldest", "", "oldest")], pageKind: "older", hasMore: false,
    });
    const refreshed = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 3,
      entries: [entry("tail", "", "tail updated")], hasMore: true,
    });
    expect(refreshed.hasMore).toBe(false);
    expect(refreshed.beforeCursor).toBeNull();
  });

  test("a slower older-page response still advances its cursor after a newer tail poll", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("tail", "", "tail")], hasMore: true,
    });
    state = historyReducer(state, { type: "started", paneId: "pane-a", requestId: 2 });
    state = historyReducer(state, { type: "started", paneId: "pane-a", requestId: 3 });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 3,
      entries: [entry("tail", "", "tail refreshed")], hasMore: true,
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2,
      entries: [entry("older", "", "older")], pageKind: "older", hasMore: false,
    });

    expect(state.entries.map((item) => item.uuid)).toEqual(["older", "tail"]);
    expect(state.beforeCursor).toBeNull();
    expect(state.hasMore).toBe(false);
    expect(state.requestId).toBe(3);
  });

  test("keeps optimistic messages across stale and empty history snapshots", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-1", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [], hasMore: false,
    });
    expect(state.outgoing).toEqual([{
      id: "optimistic-1", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"), attemptOrder: 0, status: "pending",
    }]);
    expect(optimisticEntries(state)).toEqual([{
      uuid: "optimistic-1", ts: "2026-10-01T00:00:01.000Z", role: "user", parts: [{ kind: "text", text: "hello" }],
    }]);
  });

  test("confirms only matching user text with a timestamp at or after send time", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-1", text: "hello", sentAt: Date.parse("2026-10-01T00:00:02Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [
        entry("old", "2026-10-01T00:00:01Z", "hello", "user"),
        entry("wrong-text", "2026-10-01T00:00:03Z", "other", "user"),
      ],
    });
    expect(state.outgoing[0]?.status).toBe("pending");
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2, entries: [
        entry("old", "2026-10-01T00:00:01Z", "hello", "user"),
        entry("right", "2026-10-01T00:00:03Z", "hello", "user"),
      ],
    });
    expect(state.outgoing[0]).toMatchObject({ status: "sent", matchedUuid: "right" });
  });

  test("confirms persona messages using the exact text delivered with first-message instructions", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "persona-message", text: "hello", sentAt: Date.parse("2026-10-01T00:00:02Z"),
    });
    const delivered = "[Persona instructions]\nBe concise\n[End persona instructions]\n\nhello";
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("user-prefixed", "2026-10-01T00:00:03Z", delivered, "user")],
    });
    expect(state.outgoing[0]?.status).toBe("pending");
    state = historyReducer(state, { type: "outgoing-confirmation-text", paneId: "pane-a", id: "persona-message", text: delivered });
    expect(state.outgoing[0]).toMatchObject({ status: "sent", matchedUuid: "user-prefixed", text: "hello" });
  });

  test("matches repeated identical sends to distinct history entries in FIFO order", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-1", text: "same", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-2", text: "same", sentAt: Date.parse("2026-10-01T00:00:02Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [
        entry("user-1", "2026-10-01T00:00:02Z", "same", "user"),
        entry("user-2", "2026-10-01T00:00:03Z", "same", "user"),
      ],
    });
    expect(state.outgoing.map(({ status, matchedUuid }) => [status, matchedUuid])).toEqual([
      ["sent", "user-1"], ["sent", "user-2"],
    ]);
  });

  test("remembers partial text delivery across submit-only retry failures", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-stable", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, { type: "outgoing-failed", paneId: "pane-a", id: "optimistic-stable", textDelivered: true });
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-a", id: "optimistic-stable" });
    state = historyReducer(state, { type: "outgoing-failed", paneId: "pane-a", id: "optimistic-stable", textDelivered: false });
    expect(state.outgoing[0]).toMatchObject({ status: "failed", textDelivered: true });
  });

  test("does not treat an abandoned transcript entry as delivery confirmation", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-1", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [{ ...entry("rewound", "2026-10-01T00:00:02Z", "hello", "user"), abandoned: true }],
    });
    expect(state.outgoing[0]?.status).toBe("pending");
    expect(optimisticEntries(state)).toHaveLength(1);
  });

  test("marks a failure without a server delivery signal as unknown", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-unknown", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-failed", paneId: "pane-a", id: "optimistic-unknown", textDelivered: null,
    });
    expect(state.outgoing[0]).toMatchObject({ status: "failed", deliveryUnknown: true });
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-a", id: "optimistic-unknown" });
    state = historyReducer(state, {
      type: "outgoing-failed", paneId: "pane-a", id: "optimistic-unknown", textDelivered: false,
    });
    expect(state.outgoing[0]).toMatchObject({ status: "failed", deliveryUnknown: true });
  });

  test("a late reply failure cannot undo history confirmation or re-enable retry", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-stable", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("confirmed", "2026-10-01T00:00:02Z", "hello", "user")],
    });
    const confirmed = state.outgoing[0];
    state = historyReducer(state, {
      type: "outgoing-failed", paneId: "pane-a", id: "optimistic-stable", textDelivered: true,
    });
    expect(state.outgoing[0]).toBe(confirmed);
    expect(state.outgoing[0]).toMatchObject({ status: "sent", matchedUuid: "confirmed" });
  });

  test("delivery confirmation is consumed monotonically in outgoing order", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-a", text: "A", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-b", text: "B", sentAt: Date.parse("2026-10-01T00:00:02Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1, entries: [
        entry("history-b-early", "2026-10-01T00:00:03Z", "B", "user"),
        entry("history-a", "2026-10-01T00:00:04Z", "A", "user"),
      ],
    });
    expect(state.outgoing.map(({ status, matchedUuid }) => [status, matchedUuid])).toEqual([
      ["sent", "history-a"], ["pending", undefined],
    ]);

    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2, entries: [
        entry("history-b-early", "2026-10-01T00:00:03Z", "B", "user"),
        entry("history-a", "2026-10-01T00:00:04Z", "A", "user"),
        entry("history-b-later", "2026-10-01T00:00:05Z", "B", "user"),
      ],
    });
    expect(state.outgoing.map(({ matchedUuid }) => matchedUuid)).toEqual(["history-a", "history-b-later"]);
  });

  test("a queued retry can still confirm delivery from its earlier attempt", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-a", text: "A", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-failed", paneId: "pane-a", id: "optimistic-a", textDelivered: null,
    });
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-a", id: "optimistic-a" });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("history-a", "2026-10-01T00:00:02Z", "A", "user")],
    });
    expect(state.outgoing[0]).toMatchObject({ status: "sent", matchedUuid: "history-a", deliveryUnknown: false });
  });

  test("a retry is matched in its latest attempt order, not creation order", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-a", text: "A", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, {
      type: "outgoing-failed", paneId: "pane-a", id: "optimistic-a", textDelivered: false,
    });
    state = historyReducer(state, {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-b", text: "B", sentAt: Date.parse("2026-10-01T00:00:02Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("history-b", "2026-10-01T00:00:03Z", "B", "user")],
    });
    state = historyReducer(state, {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-c", text: "C", sentAt: Date.parse("2026-10-01T00:00:04Z"),
    });
    state = historyReducer(state, {
      type: "received", paneId: "pane-a", requestId: 2,
      entries: [
        entry("history-b", "2026-10-01T00:00:03Z", "B", "user"),
        entry("history-c", "2026-10-01T00:00:05Z", "C", "user"),
      ],
    });
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-a", id: "optimistic-a" });
    const reorderedHistory = [
      entry("history-b", "2026-10-01T00:00:03Z", "B", "user"),
      entry("history-c", "2026-10-01T00:00:05Z", "C", "user"),
      entry("history-a", "2026-10-01T00:00:06Z", "A", "user"),
    ];
    state = historyReducer(state, { type: "received", paneId: "pane-a", requestId: 3, entries: reorderedHistory });
    expect(state.outgoing.map(({ status, matchedUuid }) => [status, matchedUuid])).toEqual([
      ["pending", undefined], ["sent", "history-b"], ["sent", "history-c"],
    ]);
    state = historyReducer(state, {
      type: "outgoing-attempt-started", paneId: "pane-a", id: "optimistic-a", attemptOrder: 4,
    });
    state = historyReducer(state, { type: "received", paneId: "pane-a", requestId: 4, entries: reorderedHistory });
    expect(state.outgoing.map(({ id, status, matchedUuid }) => [id, status, matchedUuid])).toEqual([
      ["optimistic-a", "sent", "history-a"],
      ["optimistic-b", "sent", "history-b"],
      ["optimistic-c", "sent", "history-c"],
    ]);
  });

  test("failure and retry keep the original optimistic ID", () => {
    let state = historyReducer(stateForPane("pane-a"), {
      type: "outgoing-added", paneId: "pane-a", id: "optimistic-stable", text: "hello", sentAt: Date.parse("2026-10-01T00:00:01Z"),
    });
    state = historyReducer(state, { type: "outgoing-failed", paneId: "pane-a", id: "optimistic-stable", textDelivered: false });
    expect(state.outgoing[0]?.status).toBe("failed");
    state = historyReducer(state, { type: "outgoing-retry", paneId: "pane-a", id: "optimistic-stable" });
    expect(state.outgoing[0]).toMatchObject({ id: "optimistic-stable", status: "pending" });
  });

  test("retains paging and truncation metadata across tail refreshes", () => {
    const loaded = historyReducer(stateForPane("pane-a"), {
      type: "received", paneId: "pane-a", requestId: 1,
      entries: [entry("tail", "", "tail")], hasMore: true, fileTruncated: true,
    });
    const refreshed = historyReducer(loaded, {
      type: "received", paneId: "pane-a", requestId: 2,
      entries: [entry("tail", "", "tail updated")],
    });

    expect(refreshed.hasMore).toBe(true);
    expect(refreshed.fileTruncated).toBe(true);
  });
});
