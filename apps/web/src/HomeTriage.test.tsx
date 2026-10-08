import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter } from "react-router";
import type { Root } from "react-dom/client";
import { HomeTriage } from "./HomeTriage.tsx";

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
const mira = { id: "mira", name: "Mira", avatar: { color: "#86efac" }, spaceId: "space-not-persona", mainPaneId: "main", systemPrompt: "", createdAt: "2026-10-08", status: "idle" };
const request = (id: string, personaId: string | undefined, paneId = "main", status = "pending") => ({ id, personaId, paneId, status, kind: "prompt-select", createdAt: "2026-10-08", payload: { question: "Approve build?", options: [] } });
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { await act(() => root?.unmount()); container?.remove(); globalThis.fetch = originalFetch; });
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  window.close();
});
async function mount(suspended = false, pollIntervalMs = 10000) {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><HomeTriage suspended={suspended} pollIntervalMs={pollIntervalMs} /></MemoryRouter>));
}

test("home counts distinct registry personas, not requests, spaces, legacy or settled items; links target their actual conversations", async () => {
  globalThis.fetch = (async (url: RequestInfo | URL) => String(url).endsWith("persona/list")
    ? Response.json({ personas: [mira, { ...mira, id: "sol", name: "Sol", mainPaneId: "sol-main" }] })
    : Response.json([request("1", "mira"), request("2", "mira", "task /1"), request("3", "sol", "sol-main"), request("4", "space-not-persona"), request("5", undefined), request("6", "unknown"), request("7", "mira", "main", "resolved"), request("8", "sol", "sol-main", "expired")])) as typeof fetch;
  await mount();
  expect(container.textContent).toContain("2 个伙伴需要你");
  expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/persona/mira", "/persona/mira/p/task%20%2F1", "/persona/sol"]);
});

test("successful polling removes resolved requests and hides the zero summary without push", async () => {
  let requests = [request("1", "mira")];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    return String(url).endsWith("persona/list") ? Response.json({ personas: [mira] }) : Response.json(requests);
  }) as typeof fetch;
  await mount(false, 10);
  expect(container.textContent).toContain("1 个伙伴需要你");
  requests = [request("1", "mira", "main", "resolved")];
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  expect(container.querySelector("section")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
});

test("read failure is visible and preserves only an explicitly labelled last confirmed summary", async () => {
  let fail = false;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (fail) throw new Error("offline");
    return String(url).endsWith("persona/list") ? Response.json({ personas: [mira] }) : Response.json([request("1", "mira")]);
  }) as typeof fetch;
  await mount(false, 10);
  fail = true;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("以下为上次确认的请求");
  expect(container.textContent).toContain("1 个伙伴需要你");
});
