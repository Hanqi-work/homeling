import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";
import type { Root } from "react-dom/client";
import { App } from "./App.tsx";
import type { PersonaShellSlots } from "./shell-slots.ts";
import { sessionState } from "./session-state.ts";
beforeEach(() => { sessionState.apply({ locked: false, epoch: 1, generation: "persona-shell-fixture" }); sessionState.caughtUp(); });

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
const persona = { id: "mira", name: "Mira", avatar: { color: "#86efac" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "idle" };
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { await act(() => root?.unmount()); container?.remove(); globalThis.fetch = originalFetch; sessionState.lock(); });
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  window.close();
});
let navigate: NavigateFunction;
function RouterControl() { navigate = useNavigate(); return null; }
async function mount(path: string, slots?: PersonaShellSlots) {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><RouterControl /><App slots={slots} /></MemoryRouter>));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event));
}
function mockReads(write: () => Promise<Response>) {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") return write();
    if (String(url).endsWith("persona/list")) return Response.json({ personas: [persona] });
    return Response.json({ paneId: "p", available: false, reason: "no-log" });
  }) as unknown as typeof fetch;
}

test("panel deletion is explicit, single dispatch, and partial archive failure remains visible", async () => {
  let writes = 0;
  mockReads(async () => { writes++; return Response.json({ deleted: true, archived: false }); });
  await mount("/persona/mira/details");
  expect(container.querySelector("dialog")?.open).toBe(true);
  expect(writes).toBe(0);
  await click("Delete Mira");
  expect(writes).toBe(0);
  await click("Confirm deletion");
  expect(writes).toBe(1);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("archive rename failed");
  expect(container.textContent).toContain("Space and tasks are retained");
  expect(container.textContent).not.toContain("Confirm deletion");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3100)); });
  expect(container.textContent).toContain("archive rename failed");
});

test("failed deletion exposes unknown partial result rather than claiming no resource changed", async () => {
  mockReads(async () => { throw new Error("connection lost"); });
  await mount("/persona/mira/details");
  await click("Delete Mira"); await click("Confirm deletion");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Deletion may have partially completed");
  expect(container.textContent).toContain("check Homelings and the main pane before retrying");
});

test("not-found polling during a delayed delete cannot erase its eventual partial result", async () => {
  let deleting = false;
  let finish!: (response: Response) => void;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") { deleting = true; return new Promise<Response>((resolve) => { finish = resolve; }); }
    if (String(url).endsWith("persona/list")) return Response.json({ personas: deleting ? [] : [persona] });
    return Response.json({ paneId: "p", available: false, reason: "no-log" });
  }) as unknown as typeof fetch;
  await mount("/persona/mira/details");
  await click("Delete Mira"); await click("Confirm deletion");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3100)); });
  expect(container.textContent).toContain("Deleting…");
  await act(async () => finish(Response.json({ deleted: true, archived: false })));
  expect(container.textContent).toContain("archive rename failed");
});

test("a late successful creation cannot navigate away from settings after leaving the form", async () => {
  let finish!: (response: Response) => void;
  globalThis.fetch = (async () => new Promise<Response>((resolve) => { finish = resolve; })) as unknown as typeof fetch;
  await mount("/new");
  await act(async () => {
    const input = container.querySelector("input[name=name]")!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Mira");
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  expect(finish).toBeDefined();
  await act(async () => container.querySelector('a[href="/settings"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }) as unknown as Event));
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  await act(async () => finish(Response.json({ persona })));
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
});

test("Escape closes the drawer and restores keyboard focus to its persistent homepage trigger", async () => {
  mockReads(async () => { throw new Error("unexpected write"); });
  await mount("/");
  const trigger = container.querySelector('a[aria-label="Details for Mira"]')! as HTMLElement;
  trigger.focus();
  await act(async () => trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }) as unknown as Event));
  expect(container.querySelector("dialog")?.open).toBe(true);
  await act(async () => container.querySelector("dialog")!.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event));
  expect(container.querySelector("dialog")).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Details for Mira");
});

test("unknown deletion stays visible across empty-list polling and a later locked attempt", async () => {
  let writes = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      writes++;
      if (writes === 1) throw new Error("connection lost");
      return Response.json({ error: "Session locked" }, { status: 423 });
    }
    if (String(url).endsWith("persona/list")) return Response.json({ personas: writes > 0 ? [] : [persona] });
    return Response.json({ paneId: "p", available: false, reason: "no-log" });
  }) as unknown as typeof fetch;
  await mount("/persona/mira/details");
  await click("Delete Mira"); await click("Confirm deletion");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3100)); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Deletion may have partially completed");
  await click("Confirm deletion");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("This deletion attempt was not dispatched");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("previous deletion remains unconfirmed");
});

test("a later deleted false response cannot erase an earlier unknown deletion", async () => {
  let writes = 0;
  mockReads(async () => {
    if (++writes === 1) throw new Error("connection lost");
    return Response.json({ deleted: false, archived: false });
  });
  await mount("/persona/mira/details");
  await click("Delete Mira"); await click("Confirm deletion");
  await click("Confirm deletion");
  const warning = container.querySelector('[role="alert"]')?.textContent;
  expect(warning).toContain("This attempt did not confirm deletion");
  expect(warning).toContain("previous deletion remains unconfirmed");
  expect(warning).not.toContain("Persona was not deleted");
});

test("unknown delete A then direct B then A starts a fresh detail route generation", async () => {
  const sol = { ...persona, id: "sol", name: "Sol" };
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") throw new Error("connection lost");
    if (String(url).endsWith("persona/list")) return Response.json({ personas: [persona, sol] });
    return Response.json({ paneId: "p", available: false, reason: "no-log" });
  }) as unknown as typeof fetch;
  await mount("/persona/mira/details");
  await click("Delete Mira"); await click("Confirm deletion");
  await act(async () => navigate("/persona/sol/details"));
  expect(container.querySelector("dialog h1")?.textContent).toBe("Sol");
  await act(async () => navigate("/persona/mira/details"));
  expect(container.querySelector("dialog h1")?.textContent).toBe("Mira");
  expect(container.querySelector("dialog")?.textContent).not.toContain("Loading persona");
});

test("memory route injects only the resolved persona id into the narrow slot", async () => {
  mockReads(async () => { throw new Error("unexpected write"); });
  await mount("/persona/mira/memory", { memory: (personaId) => <p>Editor for {personaId}</p> });
  expect(container.textContent).toContain("Editor for mira");
  expect(container.textContent).not.toContain("This feature is not enabled yet");
  expect(container.querySelector("dialog")).toBeNull();
});
