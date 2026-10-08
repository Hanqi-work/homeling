import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { LocaleProvider, useLocale, LanguageSettings } from "./locale.tsx";
import { MemoryRouter } from "react-router";
import { App } from "./App.tsx";

const window = new Window({ url: "https://homeling.test/lite/" });
const saved = new Map<string, PropertyDescriptor | undefined>();
let root: Root;
let container: HTMLElement;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { await act(() => root?.unmount()); container?.remove(); window.localStorage.clear(); });
afterAll(() => {
  for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  window.close();
});
function Consumer() { const { t } = useLocale(); return <p>{t("common.settings")}</p>; }
async function mount() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><Consumer /></LocaleProvider>));
}
test("actual settings changes page and navigation without replacing other settings slots", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><MemoryRouter initialEntries={["/settings"]}><App slots={{ settings: <button>Existing push and lock controls</button> }} /></MemoryRouter></LocaleProvider>));
  const existing = container.querySelector("button");
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "de"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector("h1")?.textContent).toBe("Einstellungen");
  expect(container.querySelector('a[href="/settings"]')?.textContent).toBe("Einstellungen");
  expect(container.querySelector("button")).toBe(existing);
});
test("language selection changes consumers and document language, and survives remount", async () => {
  await mount();
  expect(container.querySelector("p")?.textContent).toBe("Settings");
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "zh"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector("p")?.textContent).toBe("设置");
  expect(document.documentElement.lang).toBe("zh");
  await act(() => root.unmount()); container.remove();
  await mount();
  expect(container.querySelector("select")?.value).toBe("zh");
  expect(container.querySelector("p")?.textContent).toBe("设置");
});
