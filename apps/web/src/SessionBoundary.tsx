import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fetchPaneHistory, fetchPendingRequests, fetchPersonas, fetchSnapshot } from "./api.ts";
import { sessionState, type SessionSnapshot } from "./session-state.ts";
const SESSION_URL = `${import.meta.env.BASE_URL || "/lite/"}api/session`;
export function useSessionSnapshot(): SessionSnapshot {
  const [snapshot, setSnapshot] = useState(sessionState.get);
  useEffect(() => sessionState.subscribe(() => setSnapshot(sessionState.get())), []);
  return snapshot;
}
async function sessionRequest(action?: string, secret?: string): Promise<SessionSnapshot> {
  const response = await fetch(`${SESSION_URL}${action ? `/${action}` : ""}`, {
    method: action ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json", ...(action ? { "content-type": "application/json" } : {}), ...(action === "activity" ? { "x-homeling-session-epoch": String(sessionState.get().epoch), "x-homeling-session-generation": sessionState.get().generation ?? "" } : {}) },
    ...(action ? { body: JSON.stringify(secret ? { secret } : {}) } : {}),
  });
  const result = await response.json() as SessionSnapshot & { error?: string; code?: string };
  if (!response.ok) throw new Error(result.error ?? result.code ?? `Session ${response.status}`);
  return result;
}
async function readCatchUp(): Promise<void> {
  const [personas] = await Promise.all([fetchPersonas(), fetchSnapshot(), fetchPendingRequests()]);
  const path = window.location.pathname;
  const personaMatch = path.match(/\/persona\/([^/]+)/);
  const paneMatch = path.match(/\/(?:p|t)\/([^/]+)$/);
  const paneId = paneMatch ? decodeURIComponent(paneMatch[1]!) : personaMatch
    ? personas.personas.find((persona) => persona.id === decodeURIComponent(personaMatch[1]!))?.mainPaneId
    : undefined;
  if (paneId) await fetchPaneHistory(paneId);
}
export function SessionLockButton() {
  return <button type="button" className="min-h-11 rounded-xl border border-neutral-600 px-4 py-2 text-sm" onClick={() => {
    sessionState.lock();
    void sessionRequest("lock").catch(() => {});
  }}>Lock Homeling</button>;
}
/** The same children/router/key stay mounted; the dialog, never a redirect, owns locked focus. */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const session = useSessionSnapshot();
  const blocked = session.locked || !session.ready;
  const dialog = useRef<HTMLDialogElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [error, setError] = useState<string | null>(null);
  async function refresh(action?: string, secret?: string): Promise<void> {
    const request = ++sequence.current;
    const fence = sessionState.version();
    try {
      const next = await sessionRequest(action, secret);
      if (request !== sequence.current || fence !== sessionState.version()) return;
      if (sessionState.get().locked && !next.locked && action !== "unlock") return;
      sessionState.apply(next);
      if (next.locked) return;
      if (!sessionState.get().ready) {
        await readCatchUp();
        if (request !== sequence.current || sessionState.get().locked || sessionState.get().epoch !== next.epoch) return;
        sessionState.caughtUp();
      }
      setError(null);
    } catch (failure) {
      if (request !== sequence.current) return;
      sessionState.lock();
      setError(failure instanceof Error ? failure.message : "Session unavailable");
    }
  }
  useEffect(() => {
    let active = true;
    const check = () => { if (active && document.visibilityState !== "hidden" && !busyRef.current) void refresh(); };
    check();
    const timer = window.setInterval(check, 5_000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => { active = false; ++sequence.current; window.clearInterval(timer); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    if (blocked && !current.open) { current.showModal(); password.current?.focus(); }
    if (!blocked && current.open) current.close();
  }, [blocked]);
  useEffect(() => {
    if (blocked || session.idleDeadline === undefined) return;
    const remaining = Math.min(session.idleDeadline, session.absoluteDeadline ?? Infinity) - (session.serverNow ?? Date.now());
    const timer = window.setTimeout(() => sessionState.lock(), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [blocked, session.idleDeadline, session.absoluteDeadline, session.serverNow]);
  useEffect(() => {
    let lastActivity = 0;
    const activity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState === "hidden" || !sessionState.get().ready || Date.now() - lastActivity < 30_000) return;
      lastActivity = Date.now();
      const fence = sessionState.version();
      void sessionRequest("activity").then((next) => { if (fence === sessionState.version()) sessionState.apply(next); }).catch(() => { if (fence === sessionState.version()) sessionState.lock(); });
    };
    document.addEventListener("pointerdown", activity); document.addEventListener("keydown", activity);
    return () => { document.removeEventListener("pointerdown", activity); document.removeEventListener("keydown", activity); };
  }, []);
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const secret = password.current?.value ?? "";
    if (password.current) password.current.value = "";
    busyRef.current = true; setBusy(true); setError(null);
    await refresh("unlock", secret);
    busyRef.current = false; setBusy(false);
  }
  return <>
    <div inert={blocked}>{children}</div>
    <dialog ref={dialog} aria-labelledby="homeling-lock-title" onCancel={(event) => event.preventDefault()} className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-neutral-700 bg-neutral-950 p-6 text-neutral-100 shadow-2xl backdrop:bg-neutral-950/95">
      <h1 id="homeling-lock-title" className="text-xl font-semibold">Homeling is locked</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-400">Your place and drafts are kept. Unlock to make changes. Already-running agents continue.</p>
      <form onSubmit={(event) => void unlock(event)} className="mt-5 flex flex-col gap-3">
        <label htmlFor="homeling-unlock-secret" className="text-sm">Local unlock password</label>
        <input ref={password} id="homeling-unlock-secret" type="password" autoComplete="off" required minLength={43} maxLength={43} spellCheck={false} className="min-h-11 rounded-xl border border-neutral-600 bg-neutral-900 px-3" aria-describedby="homeling-unlock-help" />
        <p id="homeling-unlock-help" className="text-xs leading-5 text-neutral-400">Read unlock-secret in your local Homeling data directory. No password is stored in this browser.</p>
        {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
        {session.available === false ? <p role="status" className="text-sm text-amber-300">Initialize owner-only Homeling unlock credentials locally first.</p> : null}
        <button disabled={busy || session.available === false} className="min-h-11 rounded-xl bg-green-800 px-4 text-sm font-medium disabled:opacity-50">{busy ? "Checking current state…" : "Unlock"}</button>
        <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-neutral-700 px-4 text-sm" onClick={() => void refresh()}>Check session again</button>
      </form>
    </dialog>
  </>;
}
