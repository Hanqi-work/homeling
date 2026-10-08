import type { ActivityEvent, ActivityResponse, TaskOccurrence } from "@homeling/contracts";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { fetchActivity } from "./api.ts";
import { startAbortableSerialPolling } from "./polling.ts";

const labels: Record<ActivityEvent["kind"], string> = {
  "task.created": "Task created",
  "task.completed": "Task completed",
  "task.failed": "Task failed",
  "task.unknown": "Outcome unknown",
  "observation.gap": "Observation gap",
};

export function ActivityTimeline({ activity, personaId }: { activity: ActivityResponse; personaId: string }): ReactElement {
  const events = activity.events.filter((event) => event.personaId === personaId);
  const tasks = new Map<string, TaskOccurrence>();
  for (const occurrence of activity.occurrences) {
    if (occurrence.personaId === personaId && !tasks.has(occurrence.occurrenceKey)) {
      tasks.set(occurrence.occurrenceKey, occurrence);
    }
  }
  return <section className="mx-auto max-w-2xl space-y-5 p-5">
    <h1 className="text-2xl font-semibold">Activity</h1>
    {activity.observation !== "live" && <p className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-100">Observation gap · activity during downtime is unknown. Historical outcomes are not reconstructed from snapshots.</p>}
    {events.length === 0 ? <p className="text-sm text-zinc-400">No recorded activity yet.</p> : <ol className="space-y-3" role="list">
      {[...events].reverse().map((event) => {
        const task = tasks.get(event.occurrenceKey);
        return <li key={event.id}>
          <Link to={`/t/${encodeURIComponent(event.paneId)}?occurrence=${encodeURIComponent(event.occurrenceKey)}`}
            state={{ returnTo: `/persona/${encodeURIComponent(personaId)}/activity` }}
            className="block min-h-11 space-y-1 rounded-2xl border border-zinc-700 bg-zinc-900 p-4 transition-colors hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{task?.title ?? "Task"}</span><span className="text-sm text-zinc-300">{labels[event.kind]}</span></div>
            <time className="block text-xs text-zinc-400" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
            {event.detail && <p className="break-words text-sm text-zinc-400">{event.detail}</p>}
          </Link>
        </li>;
      })}
    </ol>}
    <p className="text-xs text-zinc-500">Times record when Homeling observed the event. Missing or reused panes retain their recorded task identity.</p>
  </section>;
}

export function ActivityPanel({ personaId }: { personaId: string }): ReactElement {
  const [state, setState] = useState<{ personaId: string; data?: ActivityResponse; error?: string }>({ personaId });
  useEffect(() => {
    setState({ personaId });
    const polling = startAbortableSerialPolling(async (signal) => {
      try {
        const data = await fetchActivity(personaId, signal);
        if (!signal.aborted) setState({ personaId, data });
      } catch (error) {
        if (!signal.aborted) setState((previous) => ({ personaId, ...(previous.personaId === personaId ? { data: previous.data } : {}), error: error instanceof Error ? error.message : "Activity unavailable" }));
      }
    }, 3_000);
    return () => polling.stop();
  }, [personaId]);
  const current = state.personaId === personaId ? state : { personaId };
  return <>
    {current.error && <p role="alert" className="p-4 text-sm text-amber-200">{current.error} · previously recorded activity is retained.</p>}
    {current.data ? <ActivityTimeline activity={current.data} personaId={personaId} /> : <p className="p-5 text-zinc-400">{current.error ? "Activity could not be loaded." : "Loading activity…"}</p>}
  </>;
}
