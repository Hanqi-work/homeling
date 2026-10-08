import { describe, expect, test } from "bun:test";
import { historyReducer, initialHistoryState, type HistoryState } from "./history-reducer.ts";
import type { TranscriptEntry } from "@homeling/contracts";

const entry = (uuid: string, ts: string, text: string): TranscriptEntry => ({
  uuid,
  ts,
  role: "assistant",
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
