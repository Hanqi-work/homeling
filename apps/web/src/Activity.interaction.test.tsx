import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Root } from "react-dom/client";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { TaskDetailPage } from "./TaskDetailPage.tsx";
import { sessionState } from "./session-state.ts";

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let container: HTMLElement;
const originalFetch = globalThis.fetch;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; container?.remove(); globalThis.fetch = originalFetch; sessionState.lock(); });
afterAll(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } window.close(); });
function mount() { container = document.createElement("div"); document.body.append(container); root = createRoot(container); return root; }

const occurrence = { occurrenceKey: "old", personaId: "a", spaceId: "s", paneId: "p", title: "Old build", createdAt: "2026-10-09T00:00:00Z", status: "completed" };

test("actual Activity task route refuses to fetch a reused pane's newer history", async () => {
  const calls: string[] = [];
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: string) => { calls.push(String(input)); return Response.json({ occurrence, current: false }); } });
  await act(async () => mount().render(<MemoryRouter initialEntries={["/t/p?occurrence=old"]}><Routes><Route path="/t/:paneId" element={<TaskDetailPage />} /></Routes></MemoryRouter>));
  expect(container.textContent).toContain("Old build");
  expect(container.textContent).toContain("different task occurrence");
  expect(container.querySelector("textarea")).toBeNull();
  expect(calls).toEqual(["/lite/api/activity/task/old"]);
});

test("a verified live task uses occurrence-scoped history rather than a raw pane history endpoint", async () => {
  sessionState.apply({ locked: false, epoch: 1, generation: "test" }); sessionState.caughtUp();
  const calls: string[] = [];
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: string) => {
    calls.push(String(input));
    if (String(input).endsWith("/activity/task/old")) return Response.json({ occurrence: { ...occurrence, status: "active" }, current: true, observation: "live", liveAvailable: true });
    if (String(input).endsWith("/history")) return Response.json({ paneId: "p", available: true, entries: [], hasMore: false, total: 0, fileTruncated: false });
    return Response.json({ ts: Date.now(), bridge: "connected", agents: [], shellPanes: [] });
  } });
  await act(async () => mount().render(<MemoryRouter initialEntries={["/t/p?occurrence=old"]}><Routes><Route path="/t/:paneId" element={<TaskDetailPage />} /></Routes></MemoryRouter>));
  expect(calls).toContain("/lite/api/activity/task/old/history");
  expect(calls).not.toContain("/lite/api/pane/p/history");
});

test("switching persona discards late Activity rows from the previous persona", async () => {
  const held = Promise.withResolvers<Response>();
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: string) => String(input).includes("/persona/a/") ? held.promise : Response.json({ observation: "live", events: [], occurrences: [] }) });
  const render = (personaId: string) => <MemoryRouter><ActivityPanel personaId={personaId} /></MemoryRouter>;
  await act(async () => mount().render(render("a")));
  await act(async () => root!.render(render("b")));
  await act(async () => held.resolve(Response.json({ observation: "live", occurrences: [occurrence], events: [{ id: "1", sequence: 1, dedupeKey: "old:task.completed", kind: "task.completed", personaId: "a", paneId: "p", occurrenceKey: "old", occurredAt: "2026-10-09T00:00:00Z", source: "herdr.event" }] })));
  expect(container.textContent).toContain("No recorded activity yet");
  expect(container.textContent).not.toContain("Old build");
  expect(container.querySelector('a[href*="/t/"]')).toBeNull();
});
