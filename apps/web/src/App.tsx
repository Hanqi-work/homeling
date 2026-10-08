import { snapshotToGroups, type SnapshotResponse } from "@homeling/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchSnapshot } from "./api.ts";
import { startSerialPolling } from "./polling.ts";

export function App() {
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const groups = snapshot ? snapshotToGroups(snapshot) : [];

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <header className="mb-6">
        <h1 className="text-lg font-medium">Homeling</h1>
        <p className="text-sm text-neutral-400" role="status">
          {snapshot ? `bridge ${snapshot.bridge}` : "loading snapshot…"}
          {error ? ` · ${error}` : ""}
        </p>
      </header>
      {groups.length === 0 && snapshot ? <p className="text-sm text-neutral-500">no panes</p> : null}
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.workspace.workspaceId}>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{group.workspace.label}</h2>
            {group.tabs.map((entry) => (
              <div key={entry.tab.tabId} className="mb-3">
                <h3 className="mb-1 text-sm text-neutral-400">{entry.tab.label}</h3>
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
    </main>
  );
}
