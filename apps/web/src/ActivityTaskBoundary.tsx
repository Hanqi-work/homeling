import type { ActivityTaskResponse, TaskOccurrence } from "@homeling/contracts";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { fetchTaskOccurrence } from "./api.ts";
import { startAbortableSerialPolling } from "./polling.ts";

export function RecordedTaskDetail({ occurrence, returnTo, reason }: { occurrence: TaskOccurrence; returnTo: string; reason: string }): ReactElement {
  return <main className="mx-auto max-w-2xl space-y-5 p-5" data-task-occurrence={occurrence.occurrenceKey}>
    <Link to={returnTo} className="inline-block min-h-11 py-3 text-sm text-sky-300">Back to Activity</Link>
    <h1 className="text-2xl font-semibold">{occurrence.title}</h1>
    <p className="text-sm">Recorded task · {occurrence.status === "unknown" ? "outcome unknown" : occurrence.status}</p>
    <time className="text-xs text-zinc-400" dateTime={occurrence.createdAt}>{new Date(occurrence.createdAt).toLocaleString()}</time>
    <p className="rounded-xl border border-amber-700/50 p-4 text-sm text-amber-100">{reason} Transcript cannot be reliably bound to this historical occurrence; live controls and newer pane history are not shown.</p>
    <dl className="space-y-2 break-all text-xs text-zinc-400"><dt>Pane</dt><dd>{occurrence.paneId}</dd><dt>Occurrence</dt><dd>{occurrence.occurrenceKey}</dd></dl>
  </main>;
}

export function ActivityTaskBoundary({ paneId, occurrenceKey, returnTo, children }: { paneId: string; occurrenceKey: string; returnTo: string; children: (occurrence: TaskOccurrence) => ReactElement }): ReactElement {
  const binding = `${paneId}\0${occurrenceKey}`;
  const [state, setState] = useState<Partial<ActivityTaskResponse> & { binding: string; error?: string }>({ binding });
  useEffect(() => {
    setState({ binding });
    const polling = startAbortableSerialPolling(async (signal) => {
      try {
        const result = await fetchTaskOccurrence(occurrenceKey, signal);
        if (result.occurrence?.paneId !== paneId || result.occurrence.occurrenceKey !== occurrenceKey) throw new Error("Task occurrence does not match this pane");
        if (!signal.aborted) setState({ binding, ...result });
      } catch (error) {
        if (!signal.aborted) setState({ binding, error: error instanceof Error ? error.message : "Recorded task unavailable" });
      }
    }, 2_000);
    return () => polling.stop();
  }, [binding, occurrenceKey, paneId]);
  const current = state.binding === binding ? state : { binding };
  if (current.error) return <main className="space-y-3 p-5"><Link to={returnTo}>Back to Activity</Link><p role="alert">{current.error} · live pane access is disabled.</p></main>;
  if (!current.occurrence) return <main className="p-5">Checking recorded task identity…</main>;
  if (!current.liveAvailable || current.observation !== "live" || !current.current || current.occurrence.status !== "active") {
    return <RecordedTaskDetail occurrence={current.occurrence} returnTo={returnTo} reason={!current.current ? "This pane now belongs to a different task occurrence." : current.observation !== "live" ? "Live observation is unavailable; activity during this gap is unknown." : "This occurrence has ended or its upstream session cannot be reliably identified."} />;
  }
  return children(current.occurrence);
}
