import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { getPersonaMemory, putPersonaMemory, MemoryRequestError, memoryFetch, type MemoryFetcher, type MemoryKind, type PersonaMemory } from "./persona-memory-api.ts";

export interface PersonaMemoryEditorProps { personaId: string; fetcher?: MemoryFetcher }
const kinds: MemoryKind[] = ["facts", "preferences", "project"];
const labels: Record<MemoryKind, string> = { facts: "事实", preferences: "偏好", project: "项目笔记" };
const buttonClass = "min-h-12 min-w-12 rounded-xl border border-neutral-600 px-4 py-3 text-base text-white disabled:opacity-50";

function mergeDrafts(
  current: Record<MemoryKind, string>,
  previous: PersonaMemory | null,
  next: PersonaMemory,
  savedKind?: MemoryKind,
): Record<MemoryKind, string> {
  const updated = { ...current };
  for (const kind of kinds) {
    if (kind === savedKind || !previous || current[kind] === previous.documents[kind].content) {
      updated[kind] = next.documents[kind].content;
    }
  }
  return updated;
}

export function PersonaMemoryEditor(props: PersonaMemoryEditorProps): ReactElement {
  return <MemoryEditor key={props.personaId} {...props} />;
}

function MemoryEditor({ personaId, fetcher = memoryFetch }: PersonaMemoryEditorProps): ReactElement {
  const id = useId();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [memory, setMemory] = useState<PersonaMemory | null>(null);
  const [drafts, setDrafts] = useState<Record<MemoryKind, string>>({ facts: "", preferences: "", project: "" });
  const [message, setMessage] = useState("正在加载记忆…");
  const [phase, setPhase] = useState<"loading" | "ready" | "saving" | "blocked">("loading");
  const gate = useRef(phase);
  const generation = useRef(0);
  const unknownSave = useRef(false);
  const [invalidKind, setInvalidKind] = useState<MemoryKind | null>(null);
  function transition(next: typeof phase) { gate.current = next; setPhase(next); }

  async function load(previous: PersonaMemory | null) {
    const token = ++generation.current;
    transition("loading");
    try {
      const next = await getPersonaMemory(personaId, fetcherRef.current);
      if (token !== generation.current) return;
      setDrafts((current) => mergeDrafts(current, previous, next));
      setMemory(next);
      unknownSave.current = false;
      transition("ready");
      setMessage(previous ? "已重新加载最新版本；草稿已保留，请核对后显式保存。" : "记忆已加载。");
    } catch {
      if (token !== generation.current) return;
      transition("blocked");
      setMessage(unknownSave.current
        ? "重新加载失败，保存结果未知；草稿已保留，请重新加载核对后再保存。"
        : "加载失败，草稿已保留；请重新加载后再保存。");
    }
  }
  useEffect(() => {
    void load(null);
    return () => { generation.current++; };
  }, [personaId]);

  async function save(event: FormEvent<HTMLFormElement>, kind: MemoryKind) {
    event.preventDefault();
    if (!memory || gate.current !== "ready") return;
    if (new TextEncoder().encode(drafts[kind]).byteLength > 24_000) {
      setInvalidKind(kind);
      setMessage(`${labels[kind]}超过每文档 24,000 UTF-8 字节限制；请缩短后保存。`);
      event.currentTarget.querySelector("textarea")?.focus();
      return;
    }
    setInvalidKind(null);
    const token = generation.current;
    transition("saving");
    setMessage("正在保存…");
    try {
      const next = await putPersonaMemory(personaId, { kind, content: drafts[kind], revision: memory.documents[kind].revision }, fetcherRef.current);
      if (token !== generation.current) return;
      setMemory(next);
      setDrafts((current) => mergeDrafts(current, memory, next, kind));
      transition("ready");
      setMessage("已保存，下次会话生效。");
    } catch (error) {
      if (token !== generation.current) return;
      transition("blocked");
      const definiteFailure = error instanceof MemoryRequestError && !error.deliveryUnknown;
      unknownSave.current = !(definiteFailure && (error.status === 409 || error.status === 423));
      setMessage(definiteFailure && error.status === 409
        ? "版本冲突，草稿已保留；请重新加载后核对并显式保存。"
        : definiteFailure && error.status === 423
          ? "记忆已锁定，保存被拒绝；草稿已保留，不会自动重放。请重新加载后再显式保存。"
          : "保存结果未知，草稿已保留；请重新加载核对后再保存。");
    }
  }

  return <section aria-label="Persona 记忆" className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-neutral-100">
    <h2 className="text-lg font-medium">持久记忆</h2>
    <p id={`${id}-help`} className="text-sm text-neutral-300">保存后下次会话生效；当前会话不会热吸收。</p>
    {memory ? <div className="text-sm text-neutral-300">
      <p>注入策略：{memory.injection.strategy}</p>
      {memory.injection.unsupported ? <p>此 agent 不支持原生记忆注入，请查看策略说明。</p> : null}
      {memory.injection.notice ? <p>{memory.injection.notice}</p> : null}
    </div> : null}
    <p id={`${id}-status`} role="status" aria-live="polite" className="text-sm">{message}</p>
    <button type="button" data-reload disabled={phase === "loading" || phase === "saving"} onClick={() => { void load(memory); }} className={buttonClass}>重新加载</button>
    {kinds.map((kind) => <form key={kind} data-kind={kind} onSubmit={(event) => { void save(event, kind); }} className="space-y-2">
      <label htmlFor={`${id}-${kind}`} className="block font-medium">{labels[kind]}</label>
      <textarea id={`${id}-${kind}`} name={kind} value={drafts[kind]} disabled={!memory || phase === "loading" || phase === "saving"} rows={6}
        aria-invalid={invalidKind === kind} aria-describedby={`${id}-help ${id}-status`} onChange={(event) => {
          const value = event.currentTarget.value;
          setDrafts((current) => ({ ...current, [kind]: value }));
          if (invalidKind === kind) { setInvalidKind(null); setMessage("草稿已修改，请显式保存。"); }
        }}
        className="min-h-12 w-full min-w-0 resize-y rounded-xl border border-neutral-600 bg-neutral-950 p-3 text-base text-white" />
      <button type="submit" disabled={!memory || phase !== "ready"} className={buttonClass}>保存{labels[kind]}</button>
    </form>)}
  </section>;
}
