import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter } from "react-router";
import type { Root } from "react-dom/client";
import { App } from "./App.tsx";
import { PersonaCustomize } from "./PersonaCustomize.tsx";
import { sessionState } from "./session-state.ts";

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
const initial = { id: "mira", name: "Mira", avatar: { color: "#86efac", character: "smile", pet: "none" }, spaceId: "s", mainPaneId: "p", systemPrompt: "private prompt", createdAt: "2026-10-08", status: "idle" };
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
beforeEach(() => { sessionState.apply({ locked: false, epoch: 1, generation: "customize-fixture" }); sessionState.caughtUp(); });
afterEach(async () => { await act(() => root?.unmount()); container?.remove(); globalThis.fetch = originalFetch; sessionState.lock(); });
afterAll(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } window.close(); });
async function mount() {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={["/persona/mira/customize"]}><App slots={{ customize: (id) => <PersonaCustomize key={id} personaId={id} /> }} /></MemoryRouter>));
}
async function change(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    const prototype = input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as unknown as Event);
  });
}
async function save() { await act(async () => container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event)); }
async function click(text: string) {
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === text)!.click());
}

test("locked customization keeps its draft and does not write, unlocking never automatically saves", async () => {
  let writes = 0;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; return Response.json({ error: "locked", executed: false, deliveryUnknown: false }, { status: 423 }); }
    return Response.json({ personas: [initial] });
  }) as typeof fetch;
  await mount(); await change('input[name="name"]', "Nova");
  await act(async () => sessionState.lock());
  await save();
  expect(writes).toBe(0);
  expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Nova");
  expect(container.textContent).toContain("not dispatched");
  await act(async () => { sessionState.apply({ locked: false, epoch: 2, generation: "customize-fixture" }); sessionState.caughtUp(); });
  expect(writes).toBe(0);
  await save();
  expect(writes).toBe(1);
  expect(container.textContent).toContain("not dispatched");
});

test("a pending save blocks remounted forms, and interrupted 423 remains unknown after unlock", async () => {
  let writes = 0;
  let finish!: (response: Response) => void;
  let current = initial;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; current = { ...current, ...JSON.parse(String(init.body)) }; return new Promise<Response>((resolve) => { finish = resolve; }); }
    return Response.json({ personas: [initial] });
  }) as typeof fetch;
  await mount(); await change('input[name="name"]', "Nova"); await save();
  await act(() => root.unmount()); container.remove(); await mount();
  await save();
  expect(writes).toBe(1);
  await act(async () => finish(Response.json({ code: "session.interrupted", executed: true, deliveryUnknown: true }, { status: 423 })));
  expect(container.textContent).toContain("outcome unknown");
  await act(async () => { sessionState.apply({ locked: false, epoch: 2, generation: "customize-fixture" }); sessionState.caughtUp(); });
  await save();
  expect(writes).toBe(1);
  expect(container.textContent).not.toContain("not dispatched");
  globalThis.fetch = (async () => Response.json({ personas: [current] })) as unknown as typeof fetch;
  await click("Check saved customization");
  expect(container.textContent).toContain("confirmed from the daemon");
});

test("an old initialization read cannot overwrite a save confirmed after navigation", async () => {
  let reads = 0;
  let finishSave!: (response: Response) => void;
  let finishRead!: (response: Response) => void;
  let current = initial;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") { current = { ...current, ...JSON.parse(String(init.body)) }; return new Promise<Response>((resolve) => { finishSave = resolve; }); }
    if (++reads === 4) return new Promise<Response>((resolve) => { finishRead = resolve; });
    return Response.json({ personas: [initial] });
  }) as typeof fetch;
  await mount(); await change('input[name="name"]', "Nova"); await save();
  await act(() => root.unmount()); container.remove(); await mount();
  await act(async () => finishSave(Response.json({ persona: current })));
  expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Nova");
  await act(async () => finishRead(Response.json({ personas: [initial] })));
  expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Nova");
});

test("uncertain save survives navigation and lock, only read confirmation clears it without replay", async () => {
  let current = initial;
  let writes = 0;
  let confirmRead = false;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; current = { ...current, ...JSON.parse(String(init.body)) }; throw new Error("response lost"); }
    return Response.json({ personas: [confirmRead ? current : initial] });
  }) as typeof fetch;
  await mount(); await change('input[name="name"]', "Nova"); await save();
  expect(container.textContent).toContain("outcome unknown");
  await act(() => root.unmount()); container.remove(); await mount();
  expect(container.textContent).toContain("Previous save outcome unknown");
  await act(async () => sessionState.lock());
  await save();
  await click("Check saved customization");
  expect(container.textContent).toContain("still unconfirmed");
  expect(writes).toBe(1);
  confirmRead = true;
  await click("Check saved customization");
  expect(container.textContent).toContain("confirmed from the daemon");
  expect(writes).toBe(1);
});

test("customize slot edits color, face, pet and name, saves only those fields and restores after reload", async () => {
  let current = initial;
  const writes: unknown[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") { const patch = JSON.parse(String(init.body)); writes.push(patch); current = { ...current, ...patch }; return Response.json({ persona: current }); }
    return Response.json({ personas: [current] });
  }) as typeof fetch;
  await mount();
  await change('input[name="name"]', "Nova");
  await act(async () => (container.querySelector('input[value="#93c5fd"]') as HTMLInputElement).click());
  await change('select[name="character"]', "curious");
  await change('select[name="pet"]', "cat");
  await save();
  expect(writes).toEqual([{ name: "Nova", avatar: { color: "#93c5fd", character: "curious", pet: "cat" } }]);
  expect(container.textContent).toContain("Saved");
  await act(() => root.unmount()); container.remove();
  await mount();
  expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("Nova");
  expect((container.querySelector('select[name="pet"]') as HTMLSelectElement).value).toBe("cat");
  expect(container.querySelector('[data-character="curious"][data-pet="cat"]')).not.toBeNull();
  expect(writes).toHaveLength(1);
});
