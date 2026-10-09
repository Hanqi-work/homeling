import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PendingRequest, PersonaView } from "@homeling/contracts";
import { fetchTaskOccurrence, fetchPendingRequests, fetchPersonas, fetchActivity } from "./api.ts";
import { startAbortableSerialPolling } from "./polling.ts";
import { useSessionSnapshot } from "./SessionBoundary.tsx";

export function SessionAwareHomeTriage() {
  const session = useSessionSnapshot();
  return <HomeTriage suspended={session.locked || !session.ready} />;
}

interface TriageData {
  readonly personas: readonly PersonaView[];
  readonly requests: readonly PendingRequest[];
  readonly taskLinks: ReadonlyMap<string, string>;
}

/** Read-only home summary. The session owner may suspend it without renewing a lease. */
export function HomeTriage({ suspended = false, pollIntervalMs = 2000 }: { suspended?: boolean; pollIntervalMs?: number }) {
  const [data, setData] = useState<TriageData>({ personas: [], requests: [], taskLinks: new Map() });
  const [error, setError] = useState(false);
  useEffect(() => {
    if (suspended) {
      setData({ personas: [], requests: [], taskLinks: new Map() });
      setError(false);
    }
    let stop = () => {};
    const resume = () => {
      stop();
      if (suspended || document.visibilityState === "hidden") return;
      const session = startAbortableSerialPolling(async (signal) => {
        try {
          const [registry, requests] = await Promise.all([fetchPersonas(signal), fetchPendingRequests(signal)]);
          if (signal.aborted) return;
          const taskLinks = new Map<string, string>();
          const taskOwners = registry.personas.filter((persona) => requests.some((request) => request.status === "pending" && request.personaId === persona.id && request.paneId !== persona.mainPaneId));
          await Promise.all(taskOwners.map(async (persona) => {
            try {
              const activity = await fetchActivity(persona.id, signal);
              if (signal.aborted || activity.observation !== "live") return;
              for (const request of requests) {
                if (signal.aborted) return;
                if (request.personaId !== persona.id || request.status !== "pending") continue;
                const occurrence = [...activity.occurrences].reverse().find((item) => item.paneId === request.paneId);
                if (occurrence?.status !== "active" || occurrence.personaId !== persona.id || occurrence.spaceId !== persona.spaceId) continue;
                if (request.taskOccurrenceKey !== undefined && request.taskOccurrenceKey !== occurrence.occurrenceKey) continue;
                const task = await fetchTaskOccurrence(occurrence.occurrenceKey, signal);
                if (signal.aborted) return;
                if (task.current && task.liveAvailable && task.observation === "live" && task.occurrence.occurrenceKey === occurrence.occurrenceKey && task.occurrence.paneId === request.paneId && task.occurrence.personaId === persona.id && task.occurrence.spaceId === persona.spaceId && task.occurrence.status === "active") {
                  taskLinks.set(request.id, `/p/${encodeURIComponent(request.paneId)}?occurrence=${encodeURIComponent(occurrence.occurrenceKey)}`);
                }
              }
            } catch {
              // Unconfirmed task ownership never falls back to an unscoped writable pane.
            }
          }));
          if (signal.aborted) return;
          setData({ personas: registry.personas, requests, taskLinks });
          setError(false);
        } catch {
          if (!signal.aborted) setError(true);
        }
      }, pollIntervalMs);
      stop = () => session.stop();
    };
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => { stop(); document.removeEventListener("visibilitychange", resume); };
  }, [suspended, pollIntervalMs]);

  const registry = new Map(data.personas.map((persona) => [persona.id, persona]));
  const pending = data.requests.flatMap((request) => {
    const persona = request.personaId ? registry.get(request.personaId) : undefined;
    return request.status === "pending" && persona ? [{ request, persona }] : [];
  });
  const count = new Set(pending.map(({ persona }) => persona.id)).size;
  if (suspended) return null;
  return <>
    {error && <p role="alert" className="text-sm text-amber-300">待处理请求更新失败，请稍后重试。{count > 0 ? "以下为上次确认的请求。" : ""}</p>}
    {count > 0 && <section aria-label="待处理请求" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4">
      <h2 className="font-medium" aria-live="polite">{count} 个伙伴需要你</h2>
      <ul className="mt-2 space-y-2">
        {pending.map(({ request, persona }) => {
          const to = request.paneId === persona.mainPaneId ? `/persona/${encodeURIComponent(persona.id)}` : data.taskLinks.get(request.id);
          return <li key={request.id}>
            {to ? <Link className="block rounded-lg p-2 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2" to={to}>
              {persona.name} · {request.payload.question}
            </Link> : <p className="p-2 text-sm">{persona.name} · {request.payload.question}<span className="block text-xs text-amber-200">暂不可确认任务归属，请稍后重试。</span></p>}
          </li>;
        })}
      </ul>
    </section>}
  </>;
}
