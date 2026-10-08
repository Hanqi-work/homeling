import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter, useLocation } from "react-router";
import type { Root } from "react-dom/client";
import { AppRoot } from "./AppRoot.tsx";
import { LocaleProvider, LanguageSettings } from "./locale.tsx";
import { sessionState } from "./session-state.ts";

const window = new Window({ url: "https://homeling.test/lite/p/p1" });
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { await act(() => root?.unmount()); container?.remove(); window.localStorage.clear(); globalThis.fetch = originalFetch; sessionState.lock(); });
afterAll(() => {
  for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  window.close();
});
function Location() { return <output data-location>{useLocation().pathname}</output>; }
async function changeLocale(locale: string) {
  const select = container.querySelector("select")!;
  await act(async () => { select.value = locale; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
}
async function unlock() {
  await act(async () => {
    const password = container.querySelector<HTMLInputElement>('[type="password"]')!;
    password.value = "a".repeat(43);
    password.closest("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
  });
}
function fakeServer(onReply: () => Promise<Response>) {
  let locked = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/session")) {
      if (url.endsWith("/unlock")) locked = false;
      if (url.endsWith("/lock")) locked = true;
      return Response.json({ locked, available: true, epoch: locked ? 0 : 1, generation: "boot", idleDeadline: Date.now() + 900_000, absoluteDeadline: Date.now() + 28_800_000, serverNow: Date.now() });
    }
    if (url.endsWith("/reply")) return onReply();
    if (url.endsWith("/persona/list")) return Response.json({ personas: [] });
    if (url.endsWith("/snapshot")) return Response.json({ bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: Date.now() });
    if (url.endsWith("/requests")) return Response.json([]);
    if (url.endsWith("/launchers")) return Response.json({ launchers: [] });
    if (url.includes("/history")) return Response.json({ paneId: "p1", available: true, entries: [], hasMore: false, total: 0, fileTruncated: false });
    throw new Error(`Unexpected fake request: ${url} ${init?.method}`);
  }) as typeof fetch;
}
async function mount(path = "/p/p1") {
  sessionState.lock();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><MemoryRouter initialEntries={[path]}><Location />{path !== "/settings" ? <LanguageSettings /> : null}<AppRoot slots={{ settings: <button data-other-settings>Push settings extension</button> }} /></MemoryRouter></LocaleProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}
test("production settings selector persists after root remount and retains lock and extension controls", async () => {
  fakeServer(async () => { throw new Error("unexpected business write"); });
  await mount("/settings"); await unlock();
  const extension = container.querySelector("[data-other-settings]");
  expect(container.textContent).toContain("Lock Homeling");
  await changeLocale("ko");
  expect(container.querySelector("[data-other-settings]")).toBe(extension);
  expect(container.querySelector("h1")?.textContent).toBe("설정");
  await act(() => root.unmount()); container.remove();
  await mount("/settings"); await unlock();
  expect(container.querySelector("select")?.value).toBe("ko");
  expect(container.querySelector("h1")?.textContent).toBe("설정");
});
test("production root retains its real draft and route across locale and session lock changes", async () => {
  let writes = 0;
  fakeServer(async () => { writes++; return Response.json({ ok: true }); });
  await mount(); await unlock();
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "My original draft 请继续");
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
  await changeLocale("ja");
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(textarea.value).toBe("My original draft 请继续");
  await act(() => sessionState.lock());
  await changeLocale("de");
  expect(textarea.value).toBe("My original draft 请继续");
  await unlock();
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(textarea.value).toBe("My original draft 请继续");
  expect(container.querySelector("[data-location]")?.textContent).toBe("/p/p1");
  expect(writes).toBe(0);
});
test("production root keeps an uncertain send blocked across locale changes and unlock, without replay", async () => {
  let writes = 0;
  fakeServer(async () => { writes++; return Response.json({ ok: false, deliveryUnknown: true, error: "unknown write" }, { status: 503 }); });
  await mount(); await unlock();
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Do not translate this outgoing text");
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
  await act(async () => textarea.closest("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  expect(writes).toBe(1);
  expect(textarea.disabled).toBe(true);
  await changeLocale("zh");
  expect(container.textContent).toContain("Do not translate this outgoing text");
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(textarea.disabled).toBe(true);
  await act(() => sessionState.lock()); await unlock(); await changeLocale("es");
  expect(writes).toBe(1);
  expect(textarea.disabled).toBe(true);
  expect(container.querySelector("[data-location]")?.textContent).toBe("/p/p1");
});
