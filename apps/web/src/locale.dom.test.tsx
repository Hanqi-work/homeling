import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { LocaleProvider, useLocale, LanguageSettings } from "./locale.tsx";
import { MemoryRouter } from "react-router";
import { App } from "./App.tsx";
import { ReplyComposer } from "./ReplyComposer.tsx";
import { PersonaDetailContent } from "./PersonaDetail.tsx";
import { SpecialKeyBar } from "./SpecialKeyBar.tsx";
import { PendingRequestCard } from "./PendingRequestCard.tsx";
import { ReplyRequestError } from "./api.ts";

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
test("a permission attempt refused before dispatch stays pending and its existing warning re-translates", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  let approvals = 0;
  const request = { id: "r", paneId: "p", personaId: "m", kind: "prompt-select" as const, payload: { question: "Should I continue?", options: [{ id: "1", label: "Original agent option" }] }, createdAt: "2026-10-08T00:00:00Z", status: "pending" as const };
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><PendingRequestCard request={request} onApprove={async () => { approvals++; throw new ReplyRequestError("session locked", false); }} /></LocaleProvider>));
  await act(async () => container.querySelector("button")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "de"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Gesperrt");
  expect(container.querySelector("article")?.getAttribute("data-status")).toBe("pending");
  expect(container.querySelector("button")?.disabled).toBe(false);
  expect(container.textContent).toContain("Should I continue?");
  expect(container.textContent).toContain("Original agent option");
  expect(approvals).toBe(1);
});
test("special-key confirmation stays open and translates without sending a key", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><SpecialKeyBar paneId="p" identity="same-pane" disabled={false} /></LocaleProvider>));
  await act(async () => [...container.querySelectorAll("button")].find((item) => item.textContent === "Ctrl+C")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "de"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector('[role="group"]')?.textContent).toContain("Senden bestätigen");
  expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Senden der Sondertaste bestätigen");
  expect(container.querySelector('[role="group"]')?.textContent).toContain("Ctrl+C");
});
test("voice permission error already on screen follows the language selection", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const dependencies = { getStream: async () => { throw new DOMException("denied", "NotAllowedError"); }, createRecorder: () => { throw new Error("not used"); }, transcribe: async () => "not used" };
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><ReplyComposer draft="" onDraftChange={() => {}} onSend={() => {}} voiceDependencies={dependencies} /></LocaleProvider>));
  await act(async () => container.querySelector('[aria-label="Start voice input"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "ja"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("マイクの使用許可が拒否");
});
test("persona deletion confirmation changes language in place without changing the persona name", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const persona = { id: "mira", name: "Delete Mira", avatar: { color: "#86efac" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "idle" as const };
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><MemoryRouter><PersonaDetailContent persona={persona} /></MemoryRouter></LocaleProvider>));
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Delete Delete Mira")!;
  await act(async () => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "zh"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.querySelector("h1")?.textContent).toBe("Delete Mira");
  expect(container.textContent).toContain("确认删除");
  expect(container.textContent).toContain("关闭 Delete Mira 的主面板");
});
test("invalid saved locale falls back to English without crashing", async () => {
  window.localStorage.setItem("homeling.locale", "not-a-locale");
  await mount();
  expect(container.querySelector("select")?.value).toBe("en");
  expect(container.querySelector("p")?.textContent).toBe("Settings");
});
test("disabled storage keeps language usable and explicitly says the choice is not saved", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("storage denied"); } });
  try {
    await mount();
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "zh"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
    expect(container.querySelector("p")?.textContent).toBe("设置");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("无法保存");
  } finally { if (descriptor) Object.defineProperty(window, "localStorage", descriptor); else Reflect.deleteProperty(window, "localStorage"); }
});
test("composer chrome switches language without translating an existing user draft", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><LanguageSettings /><ReplyComposer draft="Please continue" onDraftChange={() => {}} onSend={() => {}} /></LocaleProvider>));
  const textarea = container.querySelector("textarea")!;
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "ja"; select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event); });
  expect(container.textContent).toContain("送信");
  expect(textarea.value).toBe("Please continue");
  expect(container.querySelector("textarea")).toBe(textarea);
  expect(textarea.getAttribute("placeholder")).toBe("メッセージを入力…");
});
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
