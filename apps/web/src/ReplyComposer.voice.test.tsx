import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { ReplyComposer } from "./ReplyComposer.tsx";
import type { AudioRecorder, VoiceInputDependencies } from "./voice-input.ts";

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
let root: Root;
let createRoot: typeof import("react-dom/client").createRoot;
let container: HTMLElement;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => { if (root) await act(() => root.unmount()); container?.remove(); });
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  window.close();
});

function media() {
  let resolve!: (text: string) => void;
  let released = 0;
  let signal: AbortSignal | undefined;
  const recorder: AudioRecorder = {
    state: "inactive", mimeType: "audio/mp4", ondataavailable: null, onstop: null, onerror: null,
    start() { this.state = "recording"; },
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["clip"]) }); this.onstop?.(); },
  };
  const dependencies: VoiceInputDependencies = {
    getStream: async () => ({ getTracks: () => [{ stop: () => { released++; } }] }),
    createRecorder: () => recorder,
    transcribe: async (_audio, abort) => { signal = abort; return new Promise<string>((r) => { resolve = r; }); },
  };
  return { dependencies, finish: (text: string) => resolve(text), released: () => released, aborted: () => signal?.aborted };
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  await act(async () => { button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event); });
}
async function mount(dependencies: VoiceInputDependencies) {
  let sends: string[] = [];
  let setDraft!: (text: string) => void;
  function Harness({ scope = "p1" }: { scope?: string }) {
    const [draft, update] = useState("原草稿");
    setDraft = update;
    return <ReplyComposer scopeId={scope} draft={draft} onDraftChange={update} onSend={() => sends.push(draft)} voiceDependencies={dependencies} />;
  }
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<Harness />));
  return { sends, edit: async (text: string) => { await act(() => setDraft(text)); }, switchPane: async () => { await act(() => root.render(<Harness scope="p2" />)); } };
}

describe("voice draft composer", () => {
  test("permission refusal is shown in the UI and leaving the composer releases recording tracks", async () => {
    const f = media();
    const getStream = f.dependencies.getStream;
    f.dependencies.getStream = async () => { throw new DOMException("denied", "NotAllowedError"); };
    const ui = await mount(f.dependencies);
    await click("开始语音输入");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("麦克风权限被拒绝");
    expect(ui.sends).toEqual([]);
    f.dependencies.getStream = getStream;
    await click("开始语音输入");
    await act(async () => root.render(null));
    expect(f.released()).toBe(1);
  });

  test("explicit sending during transcription cancels the old result instead of repopulating a draft", async () => {
    const f = media(); const ui = await mount(f.dependencies);
    await click("开始语音输入"); await click("停止并转写");
    await click("Send");
    expect(ui.sends).toEqual(["原草稿"]);
    expect(f.aborted()).toBe(true);
    await act(async () => f.finish("不应进入草稿"));
    expect(container.querySelector("textarea")!.value).toBe("原草稿");
  });

  test("recording enters an editable draft, and only explicit Send submits it", async () => {
    const f = media(); const ui = await mount(f.dependencies);
    await click("开始语音输入"); await click("停止并转写");
    expect(f.released()).toBe(1);
    await act(async () => f.finish("请继续"));
    expect(container.querySelector("textarea")!.value).toBe("原草稿\n请继续");
    expect(ui.sends).toEqual([]);
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "编辑后的转写");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    });
    await click("Send");
    expect(ui.sends).toEqual(["编辑后的转写"]);
  });

  test("late transcription cannot overwrite a newer draft or cross pane scope", async () => {
    const f = media(); const ui = await mount(f.dependencies);
    await click("开始语音输入"); await click("停止并转写");
    await ui.edit("新草稿");
    expect(f.aborted()).toBe(true);
    await act(async () => f.finish("旧语音"));
    expect(container.querySelector("textarea")!.value).toBe("新草稿");
    await click("开始语音输入"); await click("停止并转写");
    await ui.switchPane();
    expect(f.aborted()).toBe(true);
    await act(async () => f.finish("错误 pane 的语音"));
    expect(container.querySelector("textarea")!.value).toBe("新草稿");
    expect(ui.sends).toEqual([]);
  });
});
