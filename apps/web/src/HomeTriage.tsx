import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PendingRequest, PersonaView } from "@homeling/contracts";
import { fetchPendingRequests, fetchPersonas } from "./api.ts";
import { startAbortableSerialPolling } from "./polling.ts";

interface TriageData {
  readonly personas: readonly PersonaView[];
  readonly requests: readonly PendingRequest[];
}

/** Read-only home summary. The session owner may suspend it without renewing a lease. */
export function HomeTriage({ suspended = false, pollIntervalMs = 2000 }: { suspended?: boolean; pollIntervalMs?: number }) {
  const [data, setData] = useState<TriageData>({ personas: [], requests: [] });
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop = () => {};
    const resume = () => {
      stop();
      if (suspended || document.visibilityState === "hidden") return;
      const session = startAbortableSerialPolling(async (signal) => {
        try {
          const [registry, requests] = await Promise.all([fetchPersonas(signal), fetchPendingRequests(signal)]);
          if (signal.aborted) return;
          setData({ personas: registry.personas, requests });
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
        {pending.map(({ request, persona }) => <li key={request.id}>
          <Link className="block rounded-lg p-2 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2" to={request.paneId === persona.mainPaneId
            ? `/persona/${encodeURIComponent(persona.id)}`
            : `/persona/${encodeURIComponent(persona.id)}/p/${encodeURIComponent(request.paneId)}`}>
            {persona.name} · {request.payload.question}
          </Link>
        </li>)}
      </ul>
    </section>}
  </>;
}
