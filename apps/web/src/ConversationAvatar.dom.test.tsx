import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Root } from "react-dom/client";
import { ConversationPage } from "./ConversationPage.tsx";
import { sessionState } from "./session-state.ts";

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => {
  await act(() => root?.unmount()); container?.remove();
  globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; sessionState.lock();
});
afterAll(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } window.close(); });

test("a hung persona read times out to a static stale avatar, then polling can recover", async () => {
  const tasks = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const deadlines: AbortController[] = [];
  const originalSchedule = window.setTimeout;
  const originalCancel = window.clearTimeout;
  window.setTimeout = ((callback: () => void, delay: number) => { tasks.set(++timerId, { callback, delay }); return timerId; }) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => { tasks.delete(id); }) as unknown as typeof window.clearTimeout;
  AbortSignal.timeout = (_ms: number) => { const ctrl = new AbortController(); deadlines.push(ctrl); return ctrl.signal; };
  let reads = 0;
  let finishHung!: (response: Response) => void;
  const persona = { id: "mira", name: "Mira", avatar: { color: "#93c5fd", character: "curious", pet: "cat" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "thinking", statusSource: "agent" };
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).endsWith("persona/list")) {
      // Intentionally ignore AbortSignal: the UI's deadline must still invalidate this read.
      if (++reads === 2) return new Promise<Response>((resolve) => { finishHung = resolve; });
      return Response.json({ personas: [reads === 3 ? { ...persona, status: "idle" } : persona] });
    }
    if (String(url).endsWith("snapshot")) return Response.json({ bridge: "connected", ts: reads, agents: [{ paneId: "p", workspaceId: "s", tabId: "t", agent: "claude", cwd: "/work", sessionName: "s", status: "working" }], shellPanes: [] });
    if (String(url).endsWith("requests")) return Response.json([]);
    if (String(url).endsWith("launchers")) return Response.json({ launchers: [], home: "/work" });
    return Response.json({ paneId: "p", available: false, reason: "no-log", entries: [], hasMore: false });
  }) as typeof fetch;
  sessionState.apply({ locked: false, epoch: 1, generation: "orb-fixture" }); sessionState.caughtUp();
  async function pollAgain() {
    await act(async () => { for (const [id, task] of [...tasks]) { if (task.delay === 3000) { tasks.delete(id); task.callback(); } } });
  }
  try {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<MemoryRouter initialEntries={["/persona/mira"]}><Routes><Route path="/persona/:personaId" element={<ConversationPage />} /></Routes></MemoryRouter>));
    expect(container.querySelector(".persona-thinking-orb") !== null).toBe(true);
    await pollAgain();
    expect(reads).toBe(2);
    await act(async () => { for (const deadline of deadlines.splice(0)) deadline.abort(new Error("persona status timed out")); });
    expect(container.querySelector(".persona-thinking-orb") === null).toBe(true);
    expect(container.textContent).toContain("persona status timed out");
    await pollAgain();
    expect(reads).toBe(3);
    expect(container.querySelector(".persona-thinking-orb") === null).toBe(true);
    await act(async () => finishHung(Response.json({ personas: [persona] })));
    expect(container.querySelector(".persona-thinking-orb") === null).toBe(true);
    await pollAgain();
    expect(reads).toBe(4);
    expect(container.querySelector(".persona-thinking-orb") !== null).toBe(true);
  } finally { window.setTimeout = originalSchedule; window.clearTimeout = originalCancel; }
});
