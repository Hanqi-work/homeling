import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { transcriptToMessages, type PaneHistoryResponse } from "@homeling/contracts";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router";
import { fetchPaneHistory } from "./api.ts";
import { toAssistantMessages } from "./assistant-messages.ts";
import { ConversationMessage } from "./ConversationMessage.tsx";
import { historyReducer, initialHistoryState, type HistoryAction } from "./history-reducer.ts";
import { startSerialPolling } from "./polling.ts";

type HistoryPageKind = Extract<HistoryAction, { type: "received" }>["pageKind"];

interface PaneConversationProps {
  paneId: string;
}

function PaneConversation({ paneId }: PaneConversationProps): ReactElement {
  const [history, dispatch] = useReducer(historyReducer, paneId, initialHistoryState);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const requestSequence = useRef(0);
  const latestSuccessSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  function receiveHistory(response: PaneHistoryResponse, requestId: number, pageKind?: HistoryPageKind): void {
    if (!response.available) {
      dispatch({ type: "unavailable", paneId, requestId });
      if (requestId >= latestSuccessSequence.current) setError(`history ${response.reason}`);
      return;
    }
    dispatch({
      type: "received", paneId, requestId, entries: response.entries, pageKind,
      hasMore: response.hasMore, fileTruncated: response.fileTruncated,
    });
    if (requestId >= latestSuccessSequence.current) {
      latestSuccessSequence.current = requestId;
      setError(null);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    activeController.current = ctrl;
    async function poll(): Promise<void> {
      const requestId = ++requestSequence.current;
      dispatch({ type: "started", paneId, requestId });
      try {
        const response = await fetchPaneHistory(paneId, ctrl.signal);
        if (ctrl.signal.aborted) return;
        receiveHistory(response, requestId);
      } catch (err: unknown) {
        if (!ctrl.signal.aborted && requestId >= latestSuccessSequence.current) {
          setError(err instanceof Error ? err.message : "history failed");
        }
      }
    }
    const stopPolling = startSerialPolling(poll, 2000);
    return () => {
      ctrl.abort();
      if (activeController.current === ctrl) activeController.current = null;
      stopPolling();
    };
  }, [paneId]);

  async function loadOlder(): Promise<void> {
    const cursor = history.beforeCursor;
    const controller = activeController.current;
    if (!history.hasMore || !cursor || loadingOlder || !controller) return;
    const requestId = ++requestSequence.current;
    setLoadingOlder(true);
    dispatch({ type: "started", paneId, requestId });
    try {
      const response = await fetchPaneHistory(paneId, controller.signal, cursor);
      if (controller.signal.aborted) return;
      receiveHistory(response, requestId, "older");
    } catch (err: unknown) {
      if (!controller.signal.aborted && requestId >= latestSuccessSequence.current) {
        setError(err instanceof Error ? err.message : "history failed");
      }
    } finally {
      if (!controller.signal.aborted) setLoadingOlder(false);
    }
  }

  const runtimeMessages = useMemo(() => toAssistantMessages(transcriptToMessages(history.entries)), [history.entries]);
  const runtime = useExternalStoreRuntime({
    messages: runtimeMessages,
    convertMessage: (message) => message,
    onNew: async () => {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-4">
        <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-800 bg-[#1a1a1a]/95 px-4 py-3 backdrop-blur">
          <Link to="/" className="text-sm text-green-300 hover:text-green-200">← panes</Link>
          <h1 className="mt-1 truncate text-base font-medium">{paneId}</h1>
          <p className="text-xs text-neutral-400" role="status">
            {error ?? (history.available === false ? "history unavailable" : "history polling · 2s")}
          </p>
        </header>
        <ThreadPrimitive.Root className="flex flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex flex-col gap-3 pb-8">
            {history.fileTruncated ? (
              <p className="rounded-xl border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                Bridge history was truncated; only the retained log tail is available.
              </p>
            ) : null}
            {history.hasMore ? (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mx-auto rounded-full border border-neutral-700 px-4 py-2 text-xs text-neutral-300 disabled:opacity-50"
              >
                {loadingOlder ? "Loading older messages…" : "Load older messages"}
              </button>
            ) : null}
            <ThreadPrimitive.Empty>
              <p className="py-8 text-center text-sm text-neutral-500">
                {error ? "Unable to load conversation. Last known messages are preserved when available." : "No transcript messages yet."}
              </p>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </main>
    </AssistantRuntimeProvider>
  );
}

export function ConversationPage(): ReactElement {
  const { paneId: routePaneId } = useParams();
  const paneId = routePaneId ?? "";
  if (!paneId) return <main className="p-6 text-sm">pane id missing</main>;
  return <PaneConversation key={paneId} paneId={paneId} />;
}
