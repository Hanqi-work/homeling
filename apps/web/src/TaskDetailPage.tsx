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
import { ReplyComposer } from "./ReplyComposer.tsx";
import { enqueueTaskSend, createTaskSendQueue, stopControlState, taskAvailability, taskRuntimeMinutes } from "./task-detail.ts";

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

function TaskConversation({ paneId, taskHint, returnTo }: { paneId: string; taskHint?: Task; returnTo: string }): ReactElement {
  const [history, dispatch] = useReducer(historyReducer, paneId, initialHistoryState);
  const historyRef = useRef(history);
  historyRef.current = history;
  const sendQueue = useRef(createTaskSendQueue());
  const sendAttempt = useRef(0);
  const queuedIds = useRef(new Set<string>());
  const requestSequence = useRef(0);
  const latestSuccess = useRef(0);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
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
  const [stopError, setStopError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const panes = snapshot ? [...snapshot.agents, ...snapshot.shellPanes] : [];
  const pane = panes.find((item) => item.paneId === paneId);
  const hintedStart = taskHint?.createdAt;
  const startedAt = typeof hintedStart === "number" && Number.isFinite(hintedStart) ? hintedStart : firstSeenAt;
  const availability = taskAvailability(pane?.status, Boolean(pane), snapshot !== null);
  const terminal = snapshot !== null && (availability === "finished" || availability === "unavailable");
  const stopControl = stopControlState(pane?.status, Boolean(pane), snapshot !== null, stopSent, taskHint?.status);
  const elapsedAt = terminal ? terminalAt ?? snapshot?.ts ?? now : now;
  const stateLabel = availability === "checking" ? "Checking task status…"
    : availability === "unavailable" ? "Pane unavailable · transcript retained"
      : availability === "finished" ? "Task finished"
        : `Task ${pane?.status ?? taskHint?.status ?? "starting"}`;
  const fallbackText = useMemo(() => history.entries.flatMap((entry) => entry.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)).join("\n"), [history.entries]);

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
    const session = startAbortableSerialPolling(async (signal) => {
      const id = ++requestSequence.current;
      dispatch({ type: "started", paneId, requestId: id });
      try {
        const response = await fetchPaneHistory(paneId, signal);
        if (signal.aborted) return;
        if (!response.available) {
          dispatch({ type: "unavailable", paneId, requestId: id });
          if (id >= latestSuccess.current) setHistoryError(`History unavailable: ${response.reason}`);
          return;
        }
        dispatch({ type: "received", paneId, requestId: id, entries: response.entries, hasMore: response.hasMore, fileTruncated: response.fileTruncated });
        if (id >= latestSuccess.current) {
          latestSuccess.current = id;
          setHistoryError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted && id >= latestSuccess.current) setHistoryError(error instanceof Error ? error.message : "History unavailable");
      }
    }, 2000);
    return () => session.stop();
  }, [paneId]);

  useEffect(() => {
    for (const outgoing of history.outgoing) {
      if (outgoing.matchedUuid) unblockResolved(outgoing.id);
    }
  }, [history.outgoing]);

  useEffect(() => {
    const session = startAbortableSerialPolling(async (signal) => {
      try {
        const next = await fetchSnapshot(signal);
        if (!signal.aborted) {
          setSnapshot((current) => current && current.ts > next.ts ? current : next);
          setSnapshotError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted) setSnapshotError(error instanceof Error ? error.message : "Snapshot unavailable");
      }
    }, 3000);
    return () => session.stop();
  }, []);

  useEffect(() => {
    if (!mirrorOpen) return;
    const session = startAbortableSerialPolling(async (signal) => {
      setRawLoading(true);
      try {
        const response = await fetchPaneScreen(paneId, signal);
        if (!signal.aborted) {
          setRawText(response.text);
          setRawTruncated(response.truncated === true);
          setRawError(null);
        }
      } catch (error: unknown) {
        if (!signal.aborted) setRawError(error instanceof Error ? error.message : "Pane output unavailable");
      } finally {
        if (!signal.aborted) setRawLoading(false);
      }
    }, 2000);
    return () => session.stop();
  }, [mirrorOpen, paneId]);

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
    sendQueue.current.block(id);
    setComposerBlocked(sendQueue.current.isBlocked());
  }

  function unblockResolved(id: string): void {
    sendQueue.current.unblock(id);
    setComposerBlocked(sendQueue.current.isBlocked());
  }

  function sendMessage(text: string, existing?: OutgoingMessage): void {
    if ((composerBlocked || sendQueue.current.isBlocked()) && !existing) return;
    if (existing && queuedIds.current.has(existing.id)) return;
    const outgoing: OutgoingMessage = existing
      ? { ...existing, status: "pending", retryQueued: true }
      : { id: `optimistic-${crypto.randomUUID()}`, text, sentAt: Date.now(), attemptOrder: ++sendAttempt.current, status: "pending" };
    queuedIds.current.add(outgoing.id);
    if (existing) {
      dispatch({ type: "outgoing-retry", paneId, id: existing.id });
    } else {
      dispatch({ type: "outgoing-added", paneId, id: outgoing.id, text, sentAt: outgoing.sentAt, attemptOrder: outgoing.attemptOrder });
    }
    void enqueueTaskSend(sendQueue.current, outgoing.id,
      () => historyRef.current.outgoing.some((message) => message.id === outgoing.id && message.matchedUuid),
      async () => {
        const attemptOrder = ++sendAttempt.current;
        dispatch({ type: "outgoing-attempt-started", paneId, id: outgoing.id, attemptOrder });
        try {
          await sendPaneReply(paneId, existing?.textDelivered ? "" : outgoing.text);
          if (existing?.textDelivered || existing?.deliveryUnknown) unblockResolved(outgoing.id);
        } catch (error: unknown) {
          const delivered = error instanceof ReplyRequestError ? error.textDelivered : null;
          if (existing?.textDelivered || existing?.deliveryUnknown || delivered !== false) blockUntilResolved(outgoing.id);
          dispatch({ type: "outgoing-failed", paneId, id: outgoing.id, textDelivered: delivered });
        }
      }).finally(() => queuedIds.current.delete(outgoing.id));
  }

  function submitDraft(): void {
    if (composerBlocked || sendQueue.current.isBlocked() || !draft.trim()) return;
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
      await stopPaneTask(paneId);
      setStopSent(true);
      setStopConfirm(false);
    } catch (error: unknown) {
      setStopError(error instanceof Error ? error.message : "Interrupt failed");
    } finally {
      setStopPending(false);
    }
  }

  async function loadOlder(): Promise<void> {
    if (!history.hasMore || !history.beforeCursor || loadingOlder) return;
    const id = ++requestSequence.current;
    setLoadingOlder(true);
    try {
      const response: PaneHistoryResponse = await fetchPaneHistory(paneId, undefined, history.beforeCursor);
      if (response.available) dispatch({ type: "received", paneId, requestId: id, entries: response.entries, pageKind: "older", hasMore: response.hasMore });
      else setHistoryError(`History unavailable: ${response.reason}`);
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : "Unable to load older history");
    } finally {
      setLoadingOlder(false);
    }
  }

  const title = taskHint?.launcher.label ?? pane?.paneLabel ?? pane?.terminalTitle ?? `Task ${paneId}`;
  const runtimeLabel = terminal ? "Worked" : "Working for";
  const showStop = stopControl.canStop;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-4">
        <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-800 bg-[#1a1a1a]/95 px-4 py-3 backdrop-blur">
          <Link to={returnTo} className="text-sm text-green-300 hover:text-green-200">← conversation</Link>
          <h1 className="mt-1 truncate text-base font-medium">{title}</h1>
          <p role="status" className="text-xs text-neutral-400">{stateLabel}{snapshotError ? ` · ${snapshotError}` : ""}</p>
          <p className="mt-1 text-xs text-neutral-300">{runtimeLabel} {taskRuntimeMinutes(startedAt, elapsedAt)}m</p>
          {availability === "unavailable" ? <p className="mt-2 rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-200">This pane has ended or is no longer available. Retained transcript history remains below.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setMirrorOpen((open) => !open); setRawError(null); }} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200">
              {mirrorOpen ? "Hide raw pane" : "View raw pane output"}
            </button>
            {showStop ? (
              stopConfirm ? (
                <div className="flex items-center gap-2" role="group" aria-label="Confirm task interrupt">
                  <span className="text-xs text-red-200">Send Ctrl-C to this task?</span>
                  <button type="button" onClick={() => void interruptTask()} disabled={stopPending} className="min-h-10 rounded-lg bg-red-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{stopPending ? "Sending…" : "Confirm interrupt"}</button>
                  <button type="button" onClick={() => setStopConfirm(false)} disabled={stopPending} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-xs">Cancel</button>
                </div>
              ) : <button type="button" onClick={() => setStopConfirm(true)} className="min-h-10 rounded-lg border border-red-700 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-200">Stop task</button>
            ) : null}
          </div>
          {stopControl.stillActiveAfterInterrupt ? <p role="status" className="mt-2 text-xs text-amber-300">Interrupt acknowledged; snapshot still reports this task active. You may send another interrupt.</p> : null}
          {stopError ? <p role="alert" className="mt-2 text-xs text-red-300">{stopError}</p> : null}
          {mirrorOpen ? <RawPaneMirror text={rawText ?? fallbackText} loading={rawLoading} error={rawError ? `${rawError}${rawText === null ? " · showing retained transcript fallback" : ""}` : null} truncated={rawTruncated} fallback={rawText === null} /> : null}
        </header>
        {history.fileTruncated ? <p className="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">Bridge history was truncated; retained messages are shown.</p> : null}
        {history.hasMore ? <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mb-3 self-center rounded-full border border-neutral-700 px-4 py-2 text-xs text-neutral-300">{loadingOlder ? "Loading…" : "Load older messages"}</button> : null}
        {historyError ? <p role="status" className="mb-3 text-xs text-amber-300">{historyError}</p> : null}
        <ThreadPrimitive.Root className="flex flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 pb-4">
            <ThreadPrimitive.Empty><p className="py-8 text-center text-sm text-neutral-500">{history.available === false ? "Transcript unavailable; pane may have no retained session." : "No transcript messages yet."}</p></ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
          </ThreadPrimitive.Viewport>
          {failed.length > 0 ? <section aria-label="Failed messages" className="max-h-28 overflow-y-auto border-t border-neutral-800 py-2">
            {failed.map((message) => <div key={message.id} className="flex items-center justify-between gap-3 py-1 text-xs text-red-300">
              <span className="truncate">{message.deliveryUnknown ? "Delivery unknown; retry may duplicate" : message.textDelivered ? "Text entered; submit again?" : "Send failed"}: {message.text}</span>
              <button type="button" onClick={() => sendMessage(message.text, message)} disabled={queuedIds.current.has(message.id)} className="shrink-0 rounded-lg border border-red-800 px-3 py-1.5 text-red-200">Retry</button>
            </div>)}
          </section> : null}
          <ReplyComposer scopeId={paneId} draft={draft} onDraftChange={setDraft} onSend={submitDraft} disabled={composerBlocked} />
        </ThreadPrimitive.Root>
      </main>
    </AssistantRuntimeProvider>
  );
}

export function TaskDetailPage(): ReactElement {
  const { paneId: routePaneId } = useParams();
  const location = useLocation();
  const paneId = routePaneId ?? "";
  if (!paneId) return <main className="p-6 text-sm">pane id missing</main>;
  const state = routeState(location.state, paneId);
  return <TaskConversation key={paneId} paneId={paneId} taskHint={state.task} returnTo={state.returnTo ?? "/"} />;
}
