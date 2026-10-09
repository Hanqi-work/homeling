import { useLocale } from "./locale.tsx";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { getPersonaMemory, putPersonaMemory, MemoryRequestError, memoryFetch, type MemoryFetcher, type MemoryKind, type PersonaMemory } from "./persona-memory-api.ts";

export interface PersonaMemoryEditorProps { personaId: string; fetcher?: MemoryFetcher }
const kinds: MemoryKind[] = ["facts", "preferences", "project"];
const labels: Record<MemoryKind, string> = { facts: "memory.facts", preferences: "memory.preferences", project: "memory.project" };
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
  const { t } = useLocale();
  const id = useId();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [memory, setMemory] = useState<PersonaMemory | null>(null);
  const [drafts, setDrafts] = useState<Record<MemoryKind, string>>({ facts: "", preferences: "", project: "" });
  const [message, setMessage] = useState("memory.loading");
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
      setMessage(previous ? "memory.reloaded" : "memory.loaded");
    } catch {
      if (token !== generation.current) return;
      transition("blocked");
      setMessage(unknownSave.current
        ? "memory.reloadUnknownFailed"
        : "memory.loadingFailed");
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
      setMessage("memory.tooLarge");
      event.currentTarget.querySelector("textarea")?.focus();
      return;
    }
    setInvalidKind(null);
    const token = generation.current;
    transition("saving");
    setMessage("memory.saving");
    try {
      const next = await putPersonaMemory(personaId, { kind, content: drafts[kind], revision: memory.documents[kind].revision }, fetcherRef.current);
      if (token !== generation.current) return;
      setMemory(next);
      setDrafts((current) => mergeDrafts(current, memory, next, kind));
      transition("ready");
      setMessage("memory.saved");
    } catch (error) {
      if (token !== generation.current) return;
      transition("blocked");
      const definiteFailure = error instanceof MemoryRequestError && !error.deliveryUnknown;
      unknownSave.current = !(definiteFailure && (error.status === 409 || error.status === 423));
      setMessage(definiteFailure && error.status === 409
        ? "memory.conflict"
        : definiteFailure && error.status === 423
          ? "memory.locked"
          : "memory.saveUnknown");
    }
  }

  return <section aria-label={t("memory.label")} className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-neutral-100">
    <h2 className="text-lg font-medium">{t("memory.title")}</h2>
    <p id={`${id}-help`} className="text-sm text-neutral-300">{t("memory.nextSession")}</p>
    {memory ? <div className="text-sm text-neutral-300">
      <p>{t("memory.injectionStrategy", { strategy: memory.injection.strategy === "pi-append-system-prompt" ? t("memory.nativeStrategy") : memory.injection.strategy === "first-message-prefix" ? t("memory.fallbackStrategy") : memory.injection.strategy })}</p>
      {memory.injection.unsupported ? <p>{t("memory.nativeUnsupported")}</p> : null}
      {memory.injection.notice ? <p>{memory.injection.strategy === "pi-append-system-prompt" ? t("memory.nativeNotice") : memory.injection.strategy === "first-message-prefix" ? t("memory.fallbackNotice") : memory.injection.notice}</p> : null}
    </div> : null}
    <p id={`${id}-status`} role="status" aria-live="polite" className="text-sm">{t(message, { document: invalidKind ? t(labels[invalidKind]) : "" })}</p>
    <button type="button" data-reload disabled={phase === "loading" || phase === "saving"} onClick={() => { void load(memory); }} className={buttonClass}>{t("memory.reload")}</button>
    {kinds.map((kind) => <form key={kind} data-kind={kind} onSubmit={(event) => { void save(event, kind); }} className="space-y-2">
      <label htmlFor={`${id}-${kind}`} className="block font-medium">{t(labels[kind])}</label>
      <textarea id={`${id}-${kind}`} name={kind} value={drafts[kind]} disabled={!memory || phase === "loading" || phase === "saving"} rows={6}
        aria-invalid={invalidKind === kind} aria-describedby={`${id}-help ${id}-status`} onChange={(event) => {
          const value = event.currentTarget.value;
          setDrafts((current) => ({ ...current, [kind]: value }));
          if (invalidKind === kind) { setInvalidKind(null); setMessage("memory.draftChanged"); }
        }}
        className="min-h-12 w-full min-w-0 resize-y rounded-xl border border-neutral-600 bg-neutral-950 p-3 text-base text-white" />
      <button type="submit" disabled={!memory || phase !== "ready"} className={buttonClass}>{t({ facts: "memory.saveFacts", preferences: "memory.savePreferences", project: "memory.saveProject" }[kind])}</button>
    </form>)}
  </section>;
}
