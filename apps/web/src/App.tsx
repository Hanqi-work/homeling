import { snapshotToGroups, type PersonaView, type SnapshotResponse } from "@homeling/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { createPersona, fetchPersonas, fetchSnapshot } from "./api.ts";
import { startSerialPolling } from "./polling.ts";

export function App() {
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<readonly PersonaView[]>([]);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#86efac");
  const [creating, setCreating] = useState(false);
  const colors = ["#86efac", "#fda4af", "#93c5fd", "#c4b5fd", "#fcd34d"] as const;

  useEffect(() => {
    const ctrl = new AbortController();
    const stopPolling = startSerialPolling(async () => {
      try {
        const next = await fetchSnapshot(ctrl.signal);
        if (ctrl.signal.aborted) return;
        setSnapshot((current) => current && current.ts > next.ts ? current : next);
        setError(null);
      } catch (err: unknown) {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "snapshot failed");
      }
    }, 3000);
    return () => {
      ctrl.abort();
      stopPolling();
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const stopPolling = startSerialPolling(async () => {
      try {
        const result = await fetchPersonas(ctrl.signal);
        if (!ctrl.signal.aborted) {
          setPersonas(result.personas);
          setPersonaError(null);
        }
      } catch (err: unknown) {
        if (!ctrl.signal.aborted) setPersonaError(err instanceof Error ? err.message : "Unable to load personas");
      }
    }, 3000);
    return () => { ctrl.abort(); stopPolling(); };
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setPersonaError(null);
    try {
      const persona = await createPersona({ name: name.trim(), avatar: { color } });
      setPersonas((current) => [...current, { ...persona, status: "active" }]);
      setName("");
    } catch (err: unknown) {
      setPersonaError(err instanceof Error ? err.message : "Unable to create persona");
    } finally {
      setCreating(false);
    }
  }

  const groups = snapshot ? snapshotToGroups(snapshot) : [];

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-6 sm:px-6">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-tight">Your Homelings</h1>
        <p className="mt-1 text-sm text-neutral-400" role="status">
          {snapshot ? `bridge ${snapshot.bridge}` : "Connecting to your home…"}
          {error ? ` · ${error}` : ""}
        </p>
      </header>

      <section aria-labelledby="personas-heading" className="mb-8">
        <h2 id="personas-heading" className="mb-3 text-sm font-medium text-neutral-300">Your personas</h2>
        {personas.length === 0 ? (
          <p className="mb-4 rounded-2xl bg-neutral-900 px-4 py-4 text-sm text-neutral-400">
            Create a persona to give your first conversation a dedicated space.
          </p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {personas.map((persona) => (
              <li key={persona.id}>
                <Link
                  to={`/persona/${encodeURIComponent(persona.id)}/p/${encodeURIComponent(persona.mainPaneId)}`}
                  className="flex min-h-16 items-center gap-3 rounded-2xl bg-neutral-900 px-4 py-3 transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300"
                >
                  <span aria-hidden="true" className="size-10 shrink-0 rounded-full ring-2 ring-white/10" style={{ backgroundColor: persona.avatar.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{persona.name}</span>
                    <span className="block text-sm capitalize text-neutral-400">{persona.needsAttention ? "needs attention" : persona.paused ? "paused" : persona.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="rounded-2xl bg-neutral-900 p-4">
          <label htmlFor="persona-name" className="mb-2 block text-sm font-medium">Create a persona</label>
          <input
            id="persona-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            maxLength={80}
            autoComplete="off"
            placeholder="Name your companion"
            className="min-h-12 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 text-base text-neutral-100 placeholder:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300"
          />
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm text-neutral-300">Choose a color</legend>
            <div className="flex flex-wrap gap-3">
              {colors.map((swatch) => (
                <label key={swatch} className="relative flex size-12 cursor-pointer items-center justify-center rounded-full focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-green-300">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="persona-color"
                    value={swatch}
                    checked={color === swatch}
                    onChange={() => setColor(swatch)}
                    aria-label={`Color ${swatch}`}
                  />
                  <span aria-hidden="true" className="size-8 rounded-full ring-2 ring-transparent peer-checked:ring-white peer-checked:ring-offset-2 peer-checked:ring-offset-neutral-900" style={{ backgroundColor: swatch }} />
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="mt-4 min-h-12 w-full rounded-xl bg-green-300 px-4 font-semibold text-green-950 transition-colors hover:bg-green-200 disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-100"
          >
            {creating ? "Creating space…" : "Create persona"}
          </button>
          {personaError ? <p role="alert" className="mt-3 text-sm text-rose-300">{personaError}</p> : null}
        </form>
      </section>

      <section aria-labelledby="panes-heading">
        <h2 id="panes-heading" className="mb-3 text-sm font-medium text-neutral-300">All panes</h2>
        {groups.length === 0 && snapshot ? <p className="text-sm text-neutral-500">No panes yet.</p> : null}
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.workspace.workspaceId}>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{group.workspace.label}</h3>
              {group.tabs.map((entry) => (
                <div key={entry.tab.tabId} className="mb-3">
                  <h4 className="mb-1 text-sm text-neutral-400">{entry.tab.label}</h4>
                  <ul className="flex flex-col gap-2">
                    {entry.rows.map((row) => (
                      <li key={row.id}>
                        <Link
                          to={`/p/${encodeURIComponent(row.paneId)}`}
                          className="block rounded-2xl bg-neutral-800 px-4 py-3 transition-colors hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium">{row.title}</span>
                            <span className="text-xs text-neutral-400">{row.status}</span>
                          </div>
                          <p className="mt-1 text-sm text-neutral-300">{row.preview}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
