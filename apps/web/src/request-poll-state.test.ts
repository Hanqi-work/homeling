import { describe, expect, test } from "bun:test";
import type { PendingRequest } from "@homeling/contracts";
import { RequestPollState } from "./request-poll-state.ts";

const request: PendingRequest = {
  id: "request:boot:1", paneId: "pane-a", personaId: "work", kind: "prompt-select",
  payload: { question: "Proceed?", options: [{ id: "1", label: "Yes" }] },
  createdAt: "2026-10-08T12:00:00.000Z", status: "pending",
};

describe("request poll tombstones", () => {
  test("rejects a delayed poll after a newer terminal state", () => {
    const state = new RequestPollState();
    const first = state.begin();
    expect(state.accept(first, [request], "pane-a")?.pending).toEqual([request]);
    const stale = state.begin();
    const current = state.begin();
    const update = state.accept(current, [], "pane-a");
    expect(update?.settled).toEqual([{ ...request, status: "resolved" }]);
    expect(state.accept(stale, [request], "pane-a")).toBeNull();
    expect(state.accept(state.begin(), [request], "pane-a")?.pending).toEqual([]);
  });

  test("a local settlement tombstones an id and invalidates in-flight polls", () => {
    const state = new RequestPollState();
    const inFlight = state.begin();
    state.settle(request.id);
    expect(state.accept(inFlight, [request], "pane-a")).toBeNull();
    expect(state.accept(state.begin(), [request], "pane-a")?.pending).toEqual([]);
  });

  test("filters requests owned by another pane", () => {
    const state = new RequestPollState();
    expect(state.accept(state.begin(), [request], "pane-b")?.pending).toEqual([]);
  });
});
