import type { PersonaView } from "@homeling/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router";
import { createPersona, fetchPaneHistory, fetchPersonas } from "./api.ts";
import { startSerialPolling } from "./polling.ts";
import { PersonaAvatar } from "./PersonaAvatar.tsx";
import { latestPersonaLine, personaStatusLabel } from "./persona-home.ts";
import type { PersonaShellSlots } from "./shell-slots.ts";
import { PersonaDetail } from "./PersonaDetail.tsx";
import { LanguageSettings, useLocale } from "./locale.tsx";

const control = "min-h-12 rounded-xl px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300";

export function PersonaLink({ persona, preview, stale = false }: { persona: PersonaView; preview?: string; stale?: boolean }) {
  return <Link to={`/persona/${encodeURIComponent(persona.id)}`} className="flex min-h-24 items-center gap-4 rounded-2xl bg-neutral-900 px-4 py-4 transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300">
    <PersonaAvatar avatar={persona.avatar} persona={persona} stale={stale} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-lg font-medium">{persona.name}</span>
      <span className="block text-sm text-neutral-400">{personaStatusLabel(persona, stale)}</span>
      {preview ? <span className="mt-1 block truncate text-sm text-neutral-300">{preview}</span> : null}
    </span>
  </Link>;
}

function NewPersona() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#86efac");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const creatingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true); setError(null);
    try {
      const persona = await createPersona({ name: name.trim(), avatar: { color } });
      if (mounted.current) navigate(`/persona/${encodeURIComponent(persona.id)}`);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "Creation failed; check your Homelings before retrying.");
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  }
  return <section>
    <h1 className="mb-2 text-3xl font-semibold tracking-tight">A new Homeling</h1>
    <p className="mb-8 text-neutral-400">A companion with a space of their own, on your computer.</p>
    <form onSubmit={submit} className="rounded-2xl bg-neutral-900 p-5">
      <label htmlFor="persona-name" className="mb-2 block font-medium">Name your companion</label>
      <input id="persona-name" name="name" value={name} onChange={(event) => setName(event.currentTarget.value)} required maxLength={80} autoComplete="off" className={`${control} w-full border border-neutral-700 bg-neutral-950 text-base`} />
      <fieldset className="mt-5">
        <legend className="mb-3 text-sm text-neutral-300">Choose a color</legend>
        <div className="flex flex-wrap gap-3">
          {["#86efac", "#fda4af", "#93c5fd", "#c4b5fd", "#fcd34d"].map((swatch) => <label key={swatch} className="relative flex size-12 cursor-pointer items-center justify-center rounded-full focus-within:outline focus-within:outline-2 focus-within:outline-green-300">
            <input className="peer sr-only" type="radio" name="persona-color" value={swatch} checked={color === swatch} onChange={() => setColor(swatch)} aria-label={`Color ${swatch}`} />
            <span aria-hidden="true" className="size-8 rounded-full peer-checked:ring-2 peer-checked:ring-white peer-checked:ring-offset-2 peer-checked:ring-offset-neutral-900" style={{ backgroundColor: swatch }} />
          </label>)}
        </div>
      </fieldset>
      <button type="submit" disabled={creating || !name.trim()} className={`${control} mt-6 w-full bg-green-300 font-semibold text-green-950 disabled:opacity-50`}>{creating ? "Creating space…" : "Create Homeling"}</button>
      {error ? <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p> : null}
    </form>
  </section>;
}

export function PersonaHome({ summary }: { summary?: React.ReactNode }) {
  const [personas, setPersonas] = useState<readonly PersonaView[]>([]);
  const [previews, setPreviews] = useState<Record<string, { paneId: string; text: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const stop = startSerialPolling(async () => {
      try {
        const result = await fetchPersonas(AbortSignal.any([ctrl.signal, AbortSignal.timeout(10_000)]));
        if (ctrl.signal.aborted) return;
        setPersonas(result.personas); setError(null); setLoaded(true);
      } catch (error) {
        if (!ctrl.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load Homelings");
      }
    }, 3000);
    return () => { ctrl.abort(); stop(); };
  }, []);
  const historyScopes = JSON.stringify(personas.map(({ id, mainPaneId }) => ({ id, mainPaneId })));
  useEffect(() => {
    const scopes = JSON.parse(historyScopes) as Array<{ id: string; mainPaneId: string }>;
    const ctrl = new AbortController();
    const stop = startSerialPolling(async () => {
      await Promise.all(scopes.map(async ({ id, mainPaneId }) => {
        let text: string;
        try { text = latestPersonaLine(await fetchPaneHistory(mainPaneId, AbortSignal.any([ctrl.signal, AbortSignal.timeout(10_000)]))); }
        catch { text = "Latest message unavailable"; }
        if (!ctrl.signal.aborted) setPreviews((current) => ({ ...current, [id]: { paneId: mainPaneId, text } }));
      }));
    }, 5000);
    return () => { ctrl.abort(); stop(); };
  }, [historyScopes]);
  return <section>
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight">Your Homelings</h1></header>
    {summary}
    {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-950/40 p-4 text-sm text-rose-200">Connection unavailable · {error}. Displayed data may be out of date.</p> : null}
    {!loaded && !error ? <p role="status" className="text-neutral-400">Connecting to your home…</p> : null}
    {loaded && personas.length === 0 ? <div className="rounded-2xl border border-neutral-800 p-8"><h2 className="mb-2 text-xl font-medium">Room for your first companion</h2><p className="mb-6 text-neutral-400">Create a Homeling to start a conversation in their own space.</p><Link className={`${control} inline-block bg-green-300 text-green-950`} to="/new">Create a Homeling</Link></div> : null}
    <ul className="flex flex-col gap-3">{personas.map((persona) => <li key={persona.id}>
      <PersonaLink persona={persona} stale={error !== null} preview={previews[persona.id]?.paneId === persona.mainPaneId ? previews[persona.id]?.text : "Loading latest message…"} />
      <Link to={`/persona/${encodeURIComponent(persona.id)}/details`} className={`${control} mt-1 inline-block text-sm text-neutral-400`} aria-label={`Details for ${persona.name}`}>About {persona.name}</Link>
    </li>)}</ul>
  </section>;
}

export function App({ slots = {} }: { slots?: PersonaShellSlots }) {
  const { t } = useLocale();
  return <div className="mx-auto min-h-dvh max-w-lg">
    <main className="px-5 pt-10 pb-32 sm:px-6">
      <Routes>
        <Route path="/" element={<PersonaHome summary={slots.homeSummary} />} />
        <Route path="/new" element={<NewPersona />} />
        <Route path="/persona/:personaId/details" element={<><PersonaHome summary={slots.homeSummary} /><PersonaDetail slots={slots} /></>} />
        <Route path="/persona/:personaId/memory" element={<PersonaDetail slots={slots} entry="memory" />} />
        <Route path="/persona/:personaId/activity" element={<PersonaDetail slots={slots} entry="activity" />} />
        <Route path="/persona/:personaId/customize" element={<PersonaDetail slots={slots} entry="customize" />} />
        <Route path="/settings" element={<section><h1 className="mb-6 text-3xl font-semibold">{t("common.settings")}</h1>{slots.settings}<LanguageSettings /></section>} />
        <Route path="*" element={<section><h1 className="text-2xl font-semibold">Page not found</h1><Link to="/" className={`${control} mt-4 inline-block`}>Back to Homelings</Link></section>} />
      </Routes>
    </main>
    <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg justify-around border-t border-neutral-800 bg-neutral-950 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {[["/", "Homelings"], ["/new", "New"], ["/settings", t("common.settings")]].map(([to, label]) => <NavLink key={to} to={to!} end className={({ isActive }) => `${control} text-sm ${isActive ? "bg-neutral-800 text-green-200" : "text-neutral-400"}`}>{label}</NavLink>)}
    </nav>
  </div>;
}
