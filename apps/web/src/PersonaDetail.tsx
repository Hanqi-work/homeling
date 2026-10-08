import type { PersonaView } from "@homeling/contracts";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { deletePersona, fetchPersonas, PersonaDeleteError } from "./api.ts";
import { PersonaAvatar } from "./PersonaAvatar.tsx";
import { personaStatusLabel } from "./persona-home.ts";
import { startAbortableSerialPolling } from "./polling.ts";
import type { PersonaShellSlots } from "./shell-slots.ts";

const action = "flex min-h-12 items-center justify-between rounded-xl border border-neutral-800 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300";

interface PersonaDetailContentProps {
  persona: PersonaView;
  onDeleteStarted?: () => void;
}

interface PersonaDetailProps {
  slots?: PersonaShellSlots;
  entry?: "details" | "memory" | "activity" | "customize";
}

export function PersonaDetailContent({ persona, onDeleteStarted }: PersonaDetailContentProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const inFlight = useRef(false);
  const deletionUnknown = useRef(false);
  async function remove(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true; setDeleting(true);
    if (!deletionUnknown.current) setError(null);
    onDeleteStarted?.();
    try {
      const outcome = await deletePersona(persona.id);
      if (!outcome.deleted) {
        setError(`This attempt did not confirm deletion. Check the persona’s current state before retrying.${deletionUnknown.current ? " The previous deletion remains unconfirmed and may have partially completed; check Homelings and the main pane before retrying." : ""}`);
        return;
      }
      setRemoved(true); setConfirming(false);
      setResult(outcome.archived
        ? "Homeling deleted. Main pane closed; space archived and task panes retained."
        : "Homeling deleted and main pane closed. Space and tasks are retained, but the archive rename failed. Check the retained space on this computer.");
    } catch (error) {
      if (error instanceof PersonaDeleteError && error.notDispatched) {
        setError(`Session locked. This deletion attempt was not dispatched. Unlock before explicitly retrying.${deletionUnknown.current ? " The previous deletion remains unconfirmed and may have partially completed; check Homelings and the main pane before retrying." : ""}`);
      } else {
        deletionUnknown.current = true;
        setError(`${error instanceof Error ? error.message : "Deletion failed"}. Deletion may have partially completed; check Homelings and the main pane before retrying.`);
      }
    } finally { inFlight.current = false; setDeleting(false); }
  }
  const base = `/persona/${encodeURIComponent(persona.id)}`;
  return <section>
    <div className="mb-8 flex flex-col items-center gap-4"><PersonaAvatar avatar={persona.avatar} size="detail" /><h1 id="persona-detail-title" className="text-3xl font-semibold tracking-tight">{persona.name}</h1><p className="text-sm text-neutral-400">{removed ? "Deleted" : deleting ? "Deleting…" : error ? "Deletion needs checking" : personaStatusLabel(persona)}</p></div>
    {result ? <p role="status" className="mb-5 rounded-xl border border-amber-800 p-4 text-sm text-amber-200">{result}</p> : null}
    {!removed ? <>
      <h2 className="mb-3 text-sm font-medium text-neutral-400">Computers</h2>
      <div className="mb-7 rounded-xl bg-neutral-900 p-4"><p className="font-medium">This computer</p><p className="mt-1 text-sm text-neutral-400">The local computer running Homeling · space {persona.spaceId}</p></div>
      <nav aria-label="Persona entries" className="mb-8 flex flex-col gap-2">{[["", "Open conversation"], ["/memory", "Memory"], ["/activity", "Activity"], ["/customize", "Customize"]].map(([suffix, label]) => <Link key={suffix} to={`${base}${suffix}`} className={action}>{label}<span aria-hidden="true">→</span></Link>)}</nav>
      <section aria-labelledby="delete-persona-title" className="border-t border-neutral-800 pt-5">
        <h2 id="delete-persona-title" className="mb-2 font-medium">Delete Homeling</h2>
        <p className="mb-4 text-sm leading-relaxed text-neutral-400">Deleting closes the main conversation pane and removes this Homeling. Its space is retained as an archive. Task panes keep running and are not deleted. Archive rename failures are reported separately.</p>
        {confirming ? <div className="rounded-xl border border-rose-900 p-4"><p className="mb-3 text-sm">Close {persona.name}’s main pane and delete this Homeling?</p><div className="flex gap-3"><button type="button" onClick={() => void remove()} disabled={deleting} className={`${action} text-rose-300 disabled:opacity-50`}>{deleting ? "Deleting…" : "Confirm deletion"}</button><button type="button" disabled={deleting} onClick={() => setConfirming(false)} className={action}>Cancel</button></div></div>
          : <button type="button" onClick={() => setConfirming(true)} className={`${action} w-full text-rose-300`}>Delete {persona.name}</button>}
      </section>
    </> : <Link to="/" className={action}>Back to Homelings</Link>}
    {error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}
  </section>;
}

export function PersonaDetail(props: PersonaDetailProps): ReactElement {
  const { personaId = "" } = useParams();
  return <PersonaDetailView key={`${personaId}:${props.entry ?? "details"}`} {...props} />;
}

function PersonaDetailView({ slots = {}, entry = "details" }: PersonaDetailProps): ReactElement {
  const { personaId = "" } = useParams();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const deletionScope = useRef<string | null>(null);
  const [persona, setPersona] = useState<PersonaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const session = startAbortableSerialPolling(async (signal) => {
      if (deletionScope.current === personaId) return;
      try {
        const result = await fetchPersonas(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
        if (signal.aborted || deletionScope.current === personaId) return;
        const matchingPersona = result.personas.find((item) => item.id === personaId) ?? null;
        setPersona(matchingPersona);
        setError(matchingPersona ? null : "Persona not found or already deleted");
      } catch (error) {
        if (!signal.aborted && deletionScope.current !== personaId) setError(error instanceof Error ? error.message : "Persona unavailable");
      }
    }, 3000);
    return () => session.stop();
  }, [personaId]);
  useEffect(() => {
    const element = dialog.current;
    if (entry !== "details" || !element) return;
    const previous = document.activeElement;
    if (!element.open) element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [entry]);
  function close(): void {
    navigate("/");
  }

  let body: ReactNode = null;
  if (persona && persona.id === personaId && !error) {
    if (entry === "details") {
      body = <PersonaDetailContent key={persona.id} persona={persona} onDeleteStarted={() => { deletionScope.current = persona.id; }} />;
    } else {
      body = <section><h1 className="mb-6 text-2xl font-semibold">{persona.name} · {entry}</h1>{slots[entry]?.(persona.id) ?? <p className="text-neutral-400">This feature is not enabled yet.</p>}</section>;
    }
  } else if (!error) {
    body = <p role="status">Loading persona…</p>;
  }

  const content = <>
    <Link to={entry === "details" ? "/" : `/persona/${encodeURIComponent(personaId)}/details`} className="mb-6 inline-block min-h-12 py-3 text-sm text-green-200">{entry === "details" ? "Close panel" : "Back to persona"}</Link>
    {error ? <p role="alert" className="mb-4 text-sm text-rose-300">{error}</p> : null}
    {body}
  </>;
  if (entry !== "details") return content;
  return <dialog ref={dialog} aria-label="Persona details" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="fixed inset-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-lg overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-6 text-neutral-100 backdrop:bg-black/60"><div>{content}</div></dialog>;
}
