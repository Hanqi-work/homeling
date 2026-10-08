import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { act, useState } from "react";
import { ReplyComposer } from "./ReplyComposer.tsx";
import { SpecialKeyBar, ControlKeyInteraction } from "./SpecialKeyBar.tsx";

test("key strip exposes real cancellation controls and explains disabled authorizing keys", () => {
  const html = renderToStaticMarkup(<SpecialKeyBar paneId="p" identity="i" disabled={false} />);
  expect(html).toContain('aria-label="特殊键"');
  expect(html).toContain("Ctrl+C");
  expect(html).toContain("Esc");
  expect(html).toContain("Enter");
  expect(html).toContain("Cmd");
  expect(html).toContain("审批");
});

test("choosing or cancelling a dangerous gesture never sends a key; confirm is required", async () => {
  let calls = 0;
  const interaction = new ControlKeyInteraction(() => {});
  interaction.choose("interrupt");
  expect(interaction.view.confirming).toBe("interrupt");
  expect(calls).toBe(0);
  interaction.cancel();
  await interaction.confirm(async () => { calls++; return { outcome: "accepted" }; });
  expect(calls).toBe(0);
});

test("double confirmation sends once, reports acknowledgement precisely, and debounces repeats", async () => {
  let calls = 0;
  let finish!: (result: { outcome: "accepted" }) => void;
  const interaction = new ControlKeyInteraction(() => {});
  interaction.choose("escape");
  const first = interaction.confirm(async () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  await interaction.confirm(async () => { calls++; return { outcome: "accepted" }; });
  expect(calls).toBe(1);
  expect(interaction.view.busy).toBe(true);
  finish({ outcome: "accepted" });
  await first;
  expect(interaction.view.feedback).toContain("不代表程序已处理");
  interaction.choose("interrupt");
  expect(interaction.view.confirming).toBeNull();
});

test("uncertain result locks further gestures and explicit rejection has failure feedback", async () => {
  const unknown = new ControlKeyInteraction(() => {});
  unknown.choose("interrupt");
  await unknown.confirm(async () => ({ outcome: "unknown" }));
  expect(unknown.view.feedback).toContain("不要重复发送");
  expect(unknown.view.unknown).toBe(true);
  unknown.choose("escape");
  expect(unknown.view.confirming).toBeNull();
  const rejected = new ControlKeyInteraction(() => {});
  rejected.choose("escape");
  await rejected.confirm(async () => ({ outcome: "not-submitted", error: "awaiting approval" }));
  expect(rejected.view.feedback).toContain("按键未发送：awaiting approval");
  expect(rejected.view.unknown).toBe(false);
});

test("identity invalidation cancels confirmation without releasing an in-flight or unknown gesture", async () => {
  const interaction = new ControlKeyInteraction(() => {});
  let finish!: (value: { outcome: "unknown" }) => void;
  interaction.choose("escape");
  const pending = interaction.confirm(async () => new Promise((resolve) => { finish = resolve; }));
  interaction.cancel();
  expect(interaction.view.busy).toBe(true);
  interaction.choose("interrupt");
  expect(interaction.view.confirming).toBeNull();
  finish({ outcome: "unknown" });
  await pending;
  interaction.cancel();
  expect(interaction.view.unknown).toBe(true);
});

test("mounted key strip preserves in-flight and unknown composer isolation through snapshot identity loss", async () => {
  const window = new Window();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  let reject!: (error: Error) => void;
  let keyCalls = 0;
  let sends = 0;
  globalThis.fetch = (async () => { keyCalls++; return new Promise<Response>((_resolve, fail) => { reject = fail; }); }) as unknown as typeof fetch;
  function Harness({ identity }: { identity: string | null }) {
    const [blocked, setBlocked] = useState(false);
    const [draft, setDraft] = useState("preserve draft");
    return <><SpecialKeyBar paneId="p" identity={identity} disabled={false} onBlockedChange={setBlocked} />
      <ReplyComposer draft={draft} onDraftChange={setDraft} onSend={() => { sends++; }} disabled={blocked}
        disabledReason="取消键结果未知；不要刷新后重试。" /></>;
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(button).toBeDefined();
    await act(() => { button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  }
  try {
    await act(() => root.render(<Harness identity="i" />));
    await click("Ctrl+C");
    expect(keyCalls).toBe(0);
    await click("确认发送");
    expect(keyCalls).toBe(1);
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await act(() => root.render(<Harness identity={null} />));
    await act(() => root.render(<Harness identity="i" />));
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await act(async () => { reject(new Error("response lost")); });
    expect(container.textContent).toContain("不要重复发送或刷新后重试");
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    await click("Send");
    expect(sends).toBe(0);
    expect(container.querySelector("textarea")!.value).toBe("preserve draft");
    expect(keyCalls).toBe(1);
  } finally {
    await act(() => root.unmount());
    globalThis.fetch = originalFetch;
    container.remove();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    window.close();
  }
});

test("unavailable and approval states disable cancellation controls with a visible explanation", () => {
  const html = renderToStaticMarkup(<SpecialKeyBar paneId="p" identity={null} disabled />);
  expect(html.match(/disabled=""/g)?.length).toBe(4);
  expect(html).toContain("待审批，特殊键不可用");
});
