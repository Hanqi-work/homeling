import { useLocale } from "./locale.tsx";
import { LocalizedUIError, type LocalizedCopy } from "./ui-copy.ts";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { mergeTranscripts, transcriptToMessages, type PaneHistoryResponse, type SnapshotResponse, type Task } from "@homeling/contracts";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useParams } from "react-router";
import { fetchPaneHistory, fetchPaneScreen, fetchSnapshot, ReplyRequestError, sendPaneReply, stopPaneTask } from "./api.ts";
import { toAssistantMessages } from "./assistant-messages.ts";
import { ConversationMessage } from "./ConversationMessage.tsx";
import { historyReducer, initialHistoryState, optimisticEntries, type OutgoingMessage } from "./history-reducer.ts";
import { startAbortableSerialPolling } from "./polling.ts";
import { RawPaneMirror } from "./RawPaneMirror.tsx";
import { ActivityTaskBoundary } from "./ActivityTaskBoundary.tsx";
import { ReplyComposer } from "./ReplyComposer.tsx";
import { enqueueTaskSend, createTaskSendQueue, stopControlState, taskAvailability, taskRuntimeMinutes } from "./task-detail.ts";

import { useSessionSnapshot } from "./SessionBoundary.tsx";
import { sessionState } from "./session-state.ts";
import { guardUnknownRetry } from "./send-queue.ts";

interface RouteState {
  task?: Task;
  returnTo?: string;
}

function routeState(state: unknown, paneId: string): RouteState {
  if (!state || typeof state !== "object") return {};
  const candidate = state as RouteState;
  return {
    task: candidate.task?.paneId === paneId ? candidate.task : undefined,
    returnTo: candidate.returnTo?.startsWith("/") && !candidate.returnTo.startsWith("//") ? candidate.returnTo : "/",
  };
}

function TaskConversation({ paneId, taskHint, returnTo, occurrenceKey }: { paneId: string; taskHint?: Task; returnTo: string; occurrenceKey?: string }): ReactElement {
  const { t, locale } = useLocale();
  const [history, dispatch] = useReducer(historyReducer, paneId, initialHistoryState);
  const historyRef = useRef(history);
  historyRef.current = history;
  const lockSession = useSessionSnapshot();
  const [sendQueue] = useState(() => createTaskSendQueue(sessionState.admit, (id) => {
    dispatch({ type: "outgoing-failed", paneId, id, textDelivered: false });
    queuedIds.current.delete(id);
  }));
  const sendAttempt = useRef(0);
  const queuedIds = useRef(new Set<string>());
  const requestSequence = useRef(0);
  const latestSuccess = useRef(0);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [snapshotError, setSnapshotError] = useState<LocalizedCopy | null>(null);
  const [historyError, setHistoryError] = useState<LocalizedCopy | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawError, setRawError] = useState<LocalizedCopy | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawTruncated, setRawTruncated] = useState(false);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [firstSeenAt] = useState(() => Date.now());
  const [terminalAt, setTerminalAt] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [composerBlocked, setComposerBlocked] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [stopSent, setStopSent] = useState(false);
  const [stopError, setStopError] = useState<LocalizedCopy | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const panes = snapshot ? [...snapshot.agents, ...snapshot.shellPanes] : [];
  const pane = panes.find((item) => item.paneId === paneId);
  const hintedStart = taskHint?.createdAt;
  const startedAt = typeof hintedStart === "number" && Number.isFinite(hintedStart) ? hintedStart : firstSeenAt;
  const availability = taskAvailability(pane?.status, Boolean(pane), snapshot !== null);
  const terminal = snapshot !== null && (availability === "finished" || availability === "unavailable");
  const stopControl = stopControlState(pane?.status, Boolean(pane), snapshot !== null, stopSent, taskHint?.status);
  const elapsedAt = terminal ? terminalAt ?? snapshot?.ts ?? now : now;
  const stateLabel = availability === "checking" ? t("task.checking")
    : availability === "unavailable" ? t("task.paneUnavailable")
      : availability === "finished" ? t("task.finished")
        : t("task.state", { status: t(`task.${pane?.status ?? taskHint?.status ?? "starting"}`) });
  const fallbackText = useMemo(() => history.entries.flatMap((entry) => entry.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)).join("\n"), [history.entries]);

  useEffect(() => {
    if (!lockSession.ready) sendQueue.suspend();
  }, [lockSession.ready, lockSession.epoch]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!terminal) {
      setTerminalAt(null);
      return;
    }
    setTerminalAt((current) => current ?? snapshot?.ts ?? now);
  }, [now, snapshot?.ts, terminal]);

  useEffect(() => {
    if (!stopControl.canStop) setStopConfirm(false);
  }, [stopControl.canStop]);

  useEffect(() => {
    if (!lockSession.ready) return;
    const session = startAbortableSerialPolling(async (signal) => {
      const id = ++requestSequence.current;
      dispatch({ type: "started", paneId, requestId: id });
      try {
        const response = await fetchPaneHistory(paneId, signal, undefined, occurrenceKey);
        if (signal.aborted) return;
        if (!response.available) {
          dispatch({ type: "unavailable", paneId, requestId: id });
          if (id >= latestSuccess.current) setHistoryError({ key: "task.historyUnavailable", params: { reason: response.reason } });
          return;
        }
        dispatch({ type: "received", paneId, requestId: id, entries: response.entries, hasMore: response.hasMore, fileTruncated: response.fileTruncated });
        if (id >= latestSuccess.current) {
          latestSuccess.current = id;
          setHistoryError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted && id >= latestSuccess.current) setHistoryError(error instanceof LocalizedUIError ? error.copy : { key: "task.historyFailed", params: { error: error instanceof Error ? error.message : "" } });
      }
    }, 2000);
    return () => session.stop();
  }, [paneId, lockSession.ready, lockSession.epoch]);

  useEffect(() => {
    for (const outgoing of history.outgoing) {
      if (outgoing.matchedUuid) unblockResolved(outgoing.id);
    }
  }, [history.outgoing]);

  useEffect(() => {
    if (!lockSession.ready) return;
    const session = startAbortableSerialPolling(async (signal) => {
      try {
        const next = await fetchSnapshot(signal);
        if (!signal.aborted) {
          setSnapshot((current) => current && current.ts > next.ts ? current : next);
          setSnapshotError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted) setSnapshotError(error instanceof LocalizedUIError ? error.copy : { key: "task.snapshotFailed", params: { error: error instanceof Error ? error.message : "" } });
      }
    }, 3000);
    return () => session.stop();
  }, [lockSession.ready, lockSession.epoch]);

  useEffect(() => {
    if (!mirrorOpen || !lockSession.ready) return;
    const session = startAbortableSerialPolling(async (signal) => {
      setRawLoading(true);
      try {
        const response = await fetchPaneScreen(paneId, signal, occurrenceKey);
        if (!signal.aborted) {
          setRawText(response.text);
          setRawTruncated(response.truncated === true);
          setRawError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted) setRawError(error instanceof LocalizedUIError ? error.copy : { key: "task.rawFailed", params: { error: error instanceof Error ? error.message : "" } });
      } finally {
        if (!signal.aborted) setRawLoading(false);
      }
    }, 2000);
    return () => session.stop();
  }, [mirrorOpen, paneId, lockSession.ready, lockSession.epoch]);

  const runtimeMessages = useMemo(() => {
    const optimistic = optimisticEntries(history);
    const entries = optimistic.length ? mergeTranscripts([history.entries, optimistic]) : history.entries;
    const statuses = new Map(history.outgoing.map((message) => [
      message.matchedUuid ?? message.id,
      message.deliveryUnknown ? "unknown" : message.textDelivered ? "text-entered" : message.status,
    ] as const));
    return toAssistantMessages(transcriptToMessages(entries), statuses);
  }, [history]);
  const runtime = useExternalStoreRuntime({ messages: runtimeMessages, convertMessage: (message) => message, onNew: async () => {} });
  const failed = history.outgoing.filter((message) => message.status === "failed");

  function blockUntilResolved(id: string): void {
    sendQueue.block(id);
    setComposerBlocked(sendQueue.isBlocked());
  }

  function unblockResolved(id: string): void {
    sendQueue.unblock(id);
    setComposerBlocked(sendQueue.isBlocked());
  }

  const retryLifetime = useRef(new AbortController());
  useEffect(() => {
    const lifetime = new AbortController(); retryLifetime.current = lifetime;
    return () => lifetime.abort();
  }, []);
  const retryCheckingIds = useRef(new Set<string>());
  async function retryGuard(message: OutgoingMessage, confirm: boolean, check: () => void, signal: AbortSignal): Promise<boolean> {
    return guardUnknownRetry({
      admit: () => check, signal,
      refresh: async () => {
        const response = await fetchPaneHistory(paneId, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), undefined, occurrenceKey);
        signal.throwIfAborted();
        check();
        if (!response.available) throw new Error("History unavailable");
        const action = { type: "received" as const, paneId, requestId: ++requestSequence.current, entries: response.entries, hasMore: response.hasMore, fileTruncated: response.fileTruncated };
        historyRef.current = historyReducer(historyRef.current, action);
        dispatch(action);
      },
      isConfirmed: () => historyRef.current.outgoing.some(item => item.id === message.id && !!item.matchedUuid),
      confirm: confirm ? () => window.confirm(t("task.unknownRetryConfirm")) : undefined,
    });
  }
  async function sendMessage(text: string, existing?: OutgoingMessage): Promise<void> {
    if ((composerBlocked || sendQueue.isBlocked()) && !existing) return;
    if (existing && (queuedIds.current.has(existing.id) || retryCheckingIds.current.has(existing.id))) return;
    const lifetime = retryLifetime.current.signal;
    let check: () => void;
    try { check = sessionState.admit(); } catch { return; }
    if (existing?.deliveryUnknown && !existing.textDelivered) {
      retryCheckingIds.current.add(existing.id);
      const allowed = await retryGuard(existing, true, check, lifetime);
      retryCheckingIds.current.delete(existing.id);
      if (!allowed) return;
    }
    const outgoing: OutgoingMessage = existing
      ? { ...existing, status: "pending", retryQueued: true }
      : { id: `optimistic-${crypto.randomUUID()}`, text, sentAt: Date.now(), attemptOrder: ++sendAttempt.current, status: "pending" };
    queuedIds.current.add(outgoing.id);
    if (existing) {
      dispatch({ type: "outgoing-retry", paneId, id: existing.id });
    } else {
      dispatch({ type: "outgoing-added", paneId, id: outgoing.id, text, sentAt: outgoing.sentAt, attemptOrder: outgoing.attemptOrder });
    }
    void enqueueTaskSend(sendQueue, outgoing.id,
      () => historyRef.current.outgoing.some((message) => message.id === outgoing.id && message.matchedUuid),
      async () => {
        if (lifetime.aborted) return;
        try { check(); } catch { return; }
        if (existing?.deliveryUnknown && !existing.textDelivered && !await retryGuard(existing, false, check, lifetime)) {
          if (!historyRef.current.outgoing.some(item => item.id === existing.id && item.matchedUuid)) dispatch({ type: "outgoing-failed", paneId, id: existing.id, textDelivered: null });
          return;
        }
        const attemptOrder = ++sendAttempt.current;
        dispatch({ type: "outgoing-attempt-started", paneId, id: outgoing.id, attemptOrder });
        try {
          await sendPaneReply(paneId, existing?.textDelivered ? "" : outgoing.text, occurrenceKey);
          if (existing?.textDelivered || existing?.deliveryUnknown) unblockResolved(outgoing.id);
        } catch (error: unknown) {
          const delivered = error instanceof ReplyRequestError ? error.textDelivered : null;
          if (existing?.textDelivered || existing?.deliveryUnknown || delivered !== false) blockUntilResolved(outgoing.id);
          dispatch({ type: "outgoing-failed", paneId, id: outgoing.id, textDelivered: delivered });
        }
      }).finally(() => queuedIds.current.delete(outgoing.id));
  }

  function submitDraft(): void {
    if (composerBlocked || sendQueue.isBlocked() || !draft.trim()) return;
    const text = draft;
    setDraft("");
    sendMessage(text);
  }

  async function interruptTask(): Promise<void> {
    if (stopPending) return;
    setStopPending(true);
    setStopSent(false);
    setStopError(null);
    try {
      await stopPaneTask(paneId, occurrenceKey);
      setStopSent(true);
      setStopConfirm(false);
    } catch (error: unknown) {
      setStopError(error instanceof LocalizedUIError ? error.copy : { key: "task.interruptFailed", params: { error: error instanceof Error ? error.message : "" } });
    } finally {
      setStopPending(false);
    }
  }

  async function loadOlder(): Promise<void> {
    if (!history.hasMore || !history.beforeCursor || loadingOlder) return;
    const id = ++requestSequence.current;
    setLoadingOlder(true);
    try {
      const response: PaneHistoryResponse = await fetchPaneHistory(paneId, undefined, history.beforeCursor, occurrenceKey);
      if (response.available) dispatch({ type: "received", paneId, requestId: id, entries: response.entries, pageKind: "older", hasMore: response.hasMore });
      else setHistoryError({ key: "task.historyUnavailable", params: { reason: response.reason } });
    } catch (error: unknown) {
      setHistoryError(error instanceof LocalizedUIError ? error.copy : { key: "task.historyFailed", params: { error: error instanceof Error ? error.message : "" } });
    } finally {
      setLoadingOlder(false);
    }
  }

  const title = taskHint?.launcher.label ?? pane?.paneLabel ?? pane?.terminalTitle ?? t("task.title", { paneId });
  const runtimeLabel = t(terminal ? "task.workedDuration" : "task.workingDuration", { minutes: taskRuntimeMinutes(startedAt, elapsedAt).toLocaleString(locale) });
  const showStop = stopControl.canStop;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-4">
        <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-800 bg-[#1a1a1a]/95 px-4 py-3 backdrop-blur">
          <Link to={returnTo} className="text-sm text-green-300 hover:text-green-200">{t("task.backConversation")}</Link>
          <h1 className="mt-1 truncate text-base font-medium">{title}</h1>
          <p role="status" className="text-xs text-neutral-400">{stateLabel}{snapshotError ? ` · ${t(snapshotError.key, snapshotError.params)}` : ""}</p>
          <p className="mt-1 text-xs text-neutral-300">{runtimeLabel}</p>
          {availability === "unavailable" ? <p className="mt-2 rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-200">{t("task.retainedHint")}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setMirrorOpen((open) => !open); setRawError(null); }} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200">
              {mirrorOpen ? t("task.hideMirror") : t("task.showMirror")}
            </button>
            {showStop ? (
              stopConfirm ? (
                <div className="flex items-center gap-2" role="group" aria-label={t("task.confirmInterruptLabel")}>
                  <span className="text-xs text-red-200">{t("task.confirmInterruptHint")}</span>
                  <button type="button" onClick={() => void interruptTask()} disabled={stopPending} className="min-h-10 rounded-lg bg-red-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{stopPending ? t("common.sending") : t("task.confirmInterrupt")}</button>
                  <button type="button" onClick={() => setStopConfirm(false)} disabled={stopPending} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs">{t("common.cancel")}</button>
                </div>
              ) : <button type="button" onClick={() => setStopConfirm(true)} className="min-h-10 rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-200">{t("task.stop")}</button>
            ) : null}
          </div>
          {stopControl.stillActiveAfterInterrupt ? <p role="status" className="mt-2 text-xs text-amber-300">{t("task.stillActive")}</p> : null}
          {stopError ? <p role="alert" className="mt-2 text-xs text-red-300">{t(stopError.key, stopError.params)}</p> : null}
          {mirrorOpen ? <RawPaneMirror text={rawText ?? fallbackText} loading={rawLoading} error={rawError ? `${t(rawError.key, rawError.params)}${rawText === null ? t("task.retainedFallback") : ""}` : null} truncated={rawTruncated} fallback={rawText === null} /> : null}
        </header>
        {history.fileTruncated ? <p className="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">{t("task.historyTruncated")}</p> : null}
        {history.hasMore ? <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mb-3 self-center rounded-full border border-neutral-700 px-4 py-2 text-xs text-neutral-300">{loadingOlder ? t("common.loading") : t("task.loadOlder")}</button> : null}
        {historyError ? <p role="status" className="mb-3 text-xs text-amber-300">{t(historyError.key, historyError.params)}</p> : null}
        <ThreadPrimitive.Root className="flex flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 pb-4">
            <ThreadPrimitive.Empty><p className="py-8 text-center text-sm text-neutral-500">{history.available === false ? t("task.transcriptUnavailable") : t("task.empty")}</p></ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
          </ThreadPrimitive.Viewport>
          {failed.length > 0 ? <section aria-label={t("task.failedMessages")} className="max-h-28 overflow-y-auto border-t border-neutral-800 py-2">
            {failed.map((message) => <div key={message.id} className="flex items-center justify-between gap-3 py-1 text-xs text-red-300">
              <span className="truncate">{message.deliveryUnknown ? t("task.deliveryUnknownRetry") : message.textDelivered ? t("task.submitAgain") : t("task.sendFailed")}: {message.text}</span>
              <button type="button" onClick={() => sendMessage(message.text, message)} disabled={queuedIds.current.has(message.id)} className="shrink-0 rounded-lg border border-red-800 px-3 py-1.5 text-red-200">{t("common.retry")}</button>
            </div>)}
          </section> : null}
          <ReplyComposer scopeId={paneId} draft={draft} onDraftChange={setDraft} onSend={submitDraft} disabled={!lockSession.ready || composerBlocked} />
        </ThreadPrimitive.Root>
      </main>
    </AssistantRuntimeProvider>
  );
}

export function TaskDetailPage(): ReactElement {
  const { t } = useLocale();
  const { paneId: routePaneId } = useParams();
  const location = useLocation();
  const paneId = routePaneId ?? "";
  if (!paneId) return <main className="p-6 text-sm">{t("task.paneIdMissing")}</main>;
  const state = routeState(location.state, paneId);
  const occurrenceKey = new URLSearchParams(location.search).get("occurrence");
  if (occurrenceKey) return <ActivityTaskBoundary key={occurrenceKey} paneId={paneId} occurrenceKey={occurrenceKey} returnTo={state.returnTo ?? "/"}>
    {(occurrence) => <TaskConversation key={occurrence.occurrenceKey} occurrenceKey={occurrence.occurrenceKey} paneId={paneId} taskHint={{ paneId, createdAt: Date.parse(occurrence.createdAt), launcher: { command: "", label: occurrence.title }, status: "working" }} returnTo={state.returnTo ?? "/"} />}
  </ActivityTaskBoundary>;
  return <TaskConversation key={paneId} paneId={paneId} taskHint={state.task} returnTo={state.returnTo ?? "/"} />;
}
