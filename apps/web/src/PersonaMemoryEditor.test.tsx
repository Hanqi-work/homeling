import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { PersonaMemoryEditor } from "./PersonaMemoryEditor.tsx";

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

const memory = {
  documents: {
    facts: { content: "<script>alert('memory')</script>", revision: "facts-1" },
    preferences: { content: "简洁回答", revision: "preferences-1" },
    project: { content: "项目笔记", revision: "project-1" },
  },
  effective: "next-session",
  injection: { strategy: "prompt", unsupported: true, notice: "部分 agent 不支持记忆注入" },
};
function response(body: unknown = memory, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
type Call = { url: string; init?: RequestInit };
function fake(...replies: Array<Response | Error | Promise<Response>>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error("Unexpected request");
    return reply;
  };
  return { calls, fetcher };
}
async function mount(fetcher: (url: string, init?: RequestInit) => Promise<Response>, personaId = "persona/1") {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<PersonaMemoryEditor personaId={personaId} fetcher={fetcher} />));
}
function form(kind: string): HTMLFormElement {
  return container.querySelector(`form[data-kind="${kind}"]`)!;
}
function textarea(kind: string): HTMLTextAreaElement { return form(kind).querySelector("textarea")!; }
async function edit(kind: string, content: string) {
  const input = textarea(kind);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, content);
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
}
async function submit(kind: string) {
  await act(async () => { form(kind).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event); });
}
async function reload() {
  await act(async () => { container.querySelector<HTMLButtonElement>('button[data-reload]')!.click(); });
}
function saveDisabled(kind = "facts") { return form(kind).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled; }

describe("persona memory editor public UI and fetch seam", () => {
  test("a parent rerender with a new fetcher cannot silently clear sticky unknown or overwrite drafts", async () => {
    const first = fake(response(), new Error("lost response"));
    const replacement = fake(response());
    await mount(first.fetcher, "persona");
    await edit("facts", "保留草稿");
    await submit("facts");
    await act(async () => root.render(<PersonaMemoryEditor personaId="persona" fetcher={replacement.fetcher} />));
    expect(saveDisabled()).toBe(true);
    expect(container.textContent).toContain("保存结果未知");
    expect(textarea("facts").value).toBe("保留草稿");
    expect(replacement.calls).toHaveLength(0);
    await reload();
    expect(replacement.calls).toHaveLength(1);
    expect(saveDisabled()).toBe(false);
    expect(textarea("facts").value).toBe("保留草稿");
  });
  test("a failed initial load disables saves and manual reload restores view and save", async () => {
    const f = fake(response({}, 500), response());
    await mount(f.fetcher);
    expect(saveDisabled()).toBe(true);
    expect(container.textContent).toContain("加载失败");
    await submit("facts");
    expect(f.calls).toHaveLength(1);
    await reload();
    expect(textarea("preferences").value).toBe("简洁回答");
    expect(saveDisabled()).toBe(false);
  });

  test("in-flight save blocks duplicate submits and reload, with no queued automatic replay", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const f = fake(response(), pending);
    await mount(f.fetcher);
    await edit("facts", "pending");
    await act(async () => {
      const submitEvent = () => new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event;
      form("facts").dispatchEvent(submitEvent());
      form("facts").dispatchEvent(submitEvent());
      form("preferences").dispatchEvent(submitEvent());
    });
    expect(f.calls).toHaveLength(2);
    expect(saveDisabled()).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[data-reload]')!.disabled).toBe(true);
    expect(textarea("facts").disabled).toBe(true);
    await act(async () => { finish(response()); });
    expect(f.calls).toHaveLength(2);
    expect(saveDisabled()).toBe(false);
  });

  for (const operation of ["GET", "PUT"]) {
    test(`late ${operation} from a previous persona cannot replace the current persona's memory`, async () => {
      let finish!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => { finish = resolve; });
      const other = { ...memory, documents: { ...memory.documents, facts: { content: "新 persona 的记忆", revision: "other-1" } } };
      const f = operation === "GET" ? fake(pending, response(other)) : fake(response(), pending, response(other));
      await mount(f.fetcher, "old-persona");
      if (operation === "PUT") { await edit("facts", "旧草稿"); await submit("facts"); }
      await act(async () => root.render(<PersonaMemoryEditor personaId="new-persona" fetcher={f.fetcher} />));
      expect(textarea("facts").value).toBe("新 persona 的记忆");
      await act(async () => { finish(response()); });
      expect(textarea("facts").value).toBe("新 persona 的记忆");
      expect(container.querySelector('[role="status"]')?.textContent).not.toContain("已保存");
    });
  }
  test("saving one document refreshes clean documents without discarding another document's draft", async () => {
    const next = { ...memory, documents: { ...memory.documents, facts: { content: "事实更新", revision: "facts-2" }, project: { content: "服务器项目更新", revision: "project-2" } } };
    const f = fake(response(), response(next));
    await mount(f.fetcher);
    await edit("facts", "事实更新");
    await edit("preferences", "偏好草稿");
    await submit("facts");
    expect(textarea("facts").value).toBe("事实更新");
    expect(textarea("preferences").value).toBe("偏好草稿");
    expect(textarea("project").value).toBe("服务器项目更新");
  });
  test("an invalid successful PUT response is still unknown, never announced as saved", async () => {
    const invalid = { ...memory, documents: { ...memory.documents, facts: { content: "changed" } } };
    const f = fake(response(), response(invalid));
    await mount(f.fetcher);
    await edit("facts", "保留我的草稿");
    await submit("facts");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("保存结果未知");
    expect(textarea("facts").value).toBe("保留我的草稿");
    expect(saveDisabled()).toBe(true);
  });
  for (const [kind, character, count] of [["facts", "中", 8000], ["preferences", "😀", 6000], ["project", "a", 24000]] as const) {
    test(`${kind} rejects more than 24,000 UTF-8 bytes and permits the exact boundary`, async () => {
      const f = fake(response(), response());
      await mount(f.fetcher);
      await edit(kind, character.repeat(count + 1));
      await submit(kind);
      expect(f.calls).toHaveLength(1);
      expect(container.textContent).toContain("24,000");
      expect(textarea(kind).getAttribute("aria-invalid")).toBe("true");
      expect(textarea(kind).value).toBe(character.repeat(count + 1));
      await edit(kind, character.repeat(count));
      await submit(kind);
      expect(f.calls).toHaveLength(2);
      expect(JSON.parse(f.calls[1]!.init!.body as string).content).toBe(character.repeat(count));
    });
  }
  for (const failure of ["network", "500", "503"]) {
    test(`${failure} keeps save outcome unknown across edits and a failed reload until manual reload succeeds`, async () => {
      const f = fake(response(), failure === "network" ? new Error("connection lost") : response({}, Number(failure)), new Error("reload failed"), response(), response());
      await mount(f.fetcher);
      await edit("facts", "结果不明的草稿");
      await submit("facts");
      expect(container.textContent).toContain("保存结果未知");
      expect(container.textContent).not.toContain("未保存");
      expect(textarea("facts").value).toBe("结果不明的草稿");
      await edit("preferences", "新的偏好草稿");
      await submit("preferences");
      expect(f.calls).toHaveLength(2);
      expect(saveDisabled("preferences")).toBe(true);
      await reload();
      expect(container.textContent).toContain("保存结果未知");
      expect(saveDisabled()).toBe(true);
      await submit("facts");
      expect(f.calls).toHaveLength(3);
      await reload();
      expect(f.calls).toHaveLength(4);
      expect(saveDisabled()).toBe(false);
      expect(textarea("facts").value).toBe("结果不明的草稿");
      await submit("facts");
      expect(f.calls).toHaveLength(5);
    });
  }
  test("423 reports a locked rejection, retains drafts, and never automatically replays the save", async () => {
    const f = fake(response(), response({}, 423), response());
    await mount(f.fetcher);
    await edit("project", "锁定时的草稿");
    await submit("project");
    expect(container.textContent).toContain("锁定");
    expect(container.textContent).toContain("拒绝");
    expect(textarea("project").value).toBe("锁定时的草稿");
    expect(saveDisabled("project")).toBe(true);
    await edit("facts", "另一个草稿");
    await submit("facts");
    expect(f.calls).toHaveLength(2);
    await reload();
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]!.init?.method).toBe("GET");
    expect(textarea("project").value).toBe("锁定时的草稿");
  });
  test("409 keeps the draft and requires an explicit reload before saving with a fresh revision", async () => {
    const latest = { ...memory, documents: { ...memory.documents, facts: { content: "另一端更新", revision: "facts-2" } } };
    const f = fake(response(), response({}, 409), response(latest), response(latest));
    await mount(f.fetcher);
    await edit("facts", "我的草稿");
    await submit("facts");
    expect(textarea("facts").value).toBe("我的草稿");
    expect(container.textContent).toContain("冲突");
    expect(container.textContent).toContain("重新加载");
    expect(saveDisabled()).toBe(true);
    await edit("facts", "保留的草稿");
    await submit("facts");
    expect(f.calls).toHaveLength(2);
    await reload();
    expect(textarea("facts").value).toBe("保留的草稿");
    expect(saveDisabled()).toBe(false);
    expect(f.calls).toHaveLength(3);
    await submit("facts");
    expect(JSON.parse(f.calls[3]!.init!.body as string)).toEqual({ kind: "facts", content: "保留的草稿", revision: "facts-2" });
  });
  test("views three plain-text documents and explicitly saves the selected revision for next session", async () => {
    const next = { ...memory, documents: { ...memory.documents, preferences: { content: "新的偏好", revision: "preferences-2" } } };
    const f = fake(response(), response(next));
    await mount(f.fetcher);
    expect(f.calls[0]!.url).toBe("/lite/api/persona/persona%2F1/memory");
    expect(container.querySelectorAll("textarea")).toHaveLength(3);
    expect(textarea("facts").value).toBe("<script>alert('memory')</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("下次会话生效");
    expect(container.textContent).toContain("不会热吸收");
    expect(container.textContent).toContain("部分 agent 不支持记忆注入");
    for (const input of container.querySelectorAll("textarea")) {
      expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
    await edit("preferences", "新的偏好");
    expect(f.calls).toHaveLength(1);
    await submit("preferences");
    expect(f.calls[1]!.init?.method).toBe("PUT");
    expect(new Headers(f.calls[1]!.init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(f.calls[1]!.init!.body as string)).toEqual({ kind: "preferences", content: "新的偏好", revision: "preferences-1" });
    expect(textarea("preferences").value).toBe("新的偏好");
    expect(container.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain("已保存");
  });
});
