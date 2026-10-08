import { useLocale } from "./locale.tsx";
import { LocalizedUIError, type LocalizedCopy } from "./ui-copy.ts";
import type { ActivityTaskResponse, TaskOccurrence } from "@homeling/contracts";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { fetchTaskOccurrence } from "./api.ts";
import { startAbortableSerialPolling } from "./polling.ts";

export function RecordedTaskDetail({ occurrence, returnTo, reason }: { occurrence: TaskOccurrence; returnTo: string; reason: string }): ReactElement {
  const { t, locale } = useLocale();
  return <main className="mx-auto max-w-2xl space-y-5 p-5" data-task-occurrence={occurrence.occurrenceKey}>
    <Link to={returnTo} className="inline-block min-h-11 py-3 text-sm text-sky-300">{t("activity.back")}</Link>
    <h1 className="text-2xl font-semibold">{occurrence.title}</h1>
    <p className="text-sm">{t("activity.recordedStatus", { status: t({ active: "activity.active", completed: "task.completed", failed: "task.failed", unknown: "activity.recordedUnknown" }[occurrence.status]) })}</p>
    <time className="text-xs text-zinc-400" dateTime={occurrence.createdAt}>{new Date(occurrence.createdAt).toLocaleString(locale)}</time>
    <p className="rounded-xl border border-amber-700/50 p-4 text-sm text-amber-100">{t(reason)} {t("activity.metadataOnly")}</p>
    <dl className="space-y-2 break-all text-xs text-zinc-400"><dt>{t("activity.pane")}</dt><dd>{occurrence.paneId}</dd><dt>{t("activity.occurrence")}</dt><dd>{occurrence.occurrenceKey}</dd></dl>
  </main>;
}

export function ActivityTaskBoundary({ paneId, occurrenceKey, returnTo, children }: { paneId: string; occurrenceKey: string; returnTo: string; children: (occurrence: TaskOccurrence) => ReactElement }): ReactElement {
  const { t } = useLocale();
  const binding = `${paneId}\0${occurrenceKey}`;
  const [state, setState] = useState<Partial<ActivityTaskResponse> & { binding: string; error?: LocalizedCopy }>({ binding });
  useEffect(() => {
    setState({ binding });
    const polling = startAbortableSerialPolling(async (signal) => {
      try {
        const result = await fetchTaskOccurrence(occurrenceKey, signal);
        if (result.occurrence?.paneId !== paneId || result.occurrence.occurrenceKey !== occurrenceKey) throw new LocalizedUIError("Task occurrence does not match this pane", { key: "activity.mismatch" });
        if (!signal.aborted) setState({ binding, ...result });
      } catch (error) {
        if (!signal.aborted) setState({ binding, error: error instanceof LocalizedUIError ? error.copy : { key: "activity.recordedError", params: { error: error instanceof Error ? error.message : "" } } });
      }
    }, 2_000);
    return () => polling.stop();
  }, [binding, occurrenceKey, paneId]);
  const current = state.binding === binding ? state : { binding };
  if (current.error) return <main className="space-y-3 p-5"><Link to={returnTo}>{t("activity.back")}</Link><p role="alert">{t(current.error.key, current.error.params)}</p></main>;
  if (!current.occurrence) return <main className="p-5">{t("activity.checkingIdentity")}</main>;
  if (!current.liveAvailable || current.observation !== "live" || !current.current || current.occurrence.status !== "active") {
    return <RecordedTaskDetail occurrence={current.occurrence} returnTo={returnTo} reason={!current.current ? "activity.differentOccurrence" : current.observation !== "live" ? "activity.observationUnavailable" : "activity.endedOccurrence"} />;
  }
  return children(current.occurrence);
}
