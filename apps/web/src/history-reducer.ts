import { mergeTranscripts, type TranscriptEntry } from "@homeling/contracts";

export interface HistoryState {
  readonly paneId: string;
  /** Highest request sequence started for this pane; stale responses may still add unseen entries. */
  readonly requestId: number;
  readonly entries: TranscriptEntry[];
  readonly available: boolean | null;
  readonly hasMore: boolean;
  readonly beforeCursor: string | null;
  readonly fileTruncated: boolean;
}

export type HistoryAction =
  | { type: "started"; paneId: string; requestId: number }
  | {
      type: "received";
      paneId: string;
      requestId: number;
      entries: TranscriptEntry[];
      pageKind?: "latest" | "older";
      hasMore?: boolean;
      fileTruncated?: boolean;
    }
  | { type: "unavailable"; paneId: string; requestId: number };

export function initialHistoryState(paneId: string): HistoryState {
  return {
    paneId,
    requestId: 0,
    entries: [],
    available: null,
    hasMore: false,
    beforeCursor: null,
    fileTruncated: false,
  };
}

/**
 * Keep valid unseen messages from slow/out-of-order reads, while only allowing the newest
 * response to replace existing contents. Older-page metadata advances its own cursor and cannot
 * be reopened by a later tail poll.
 */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.paneId !== state.paneId) return state;
  if (action.type === "started") {
    return action.requestId > state.requestId ? { ...state, requestId: action.requestId } : state;
  }
  if (action.type === "unavailable") {
    if (action.requestId < state.requestId) return state;
    return { ...state, requestId: action.requestId, available: false };
  }

  const stale = action.requestId < state.requestId;
  const pageKind = action.pageKind ?? "latest";
  const existingIds = new Set(state.entries.map((entry) => entry.uuid));
  const freshEntries = stale ? action.entries.filter((entry) => !existingIds.has(entry.uuid)) : action.entries;
  if (stale && freshEntries.length === 0 && pageKind !== "older") return state;
  const entries = freshEntries.length === 0
    ? state.entries
    : mergeTranscripts(pageKind === "older" ? [freshEntries, state.entries] : [state.entries, freshEntries]);

  let hasMore = state.hasMore;
  let beforeCursor = state.beforeCursor;
  if (pageKind === "older") {
    const oldestId = action.entries[0]?.uuid ?? null;
    const advanced = oldestId !== null && oldestId !== state.beforeCursor;
    hasMore = action.hasMore === true && advanced;
    beforeCursor = hasMore ? oldestId : null;
  } else if (state.entries.length === 0 && state.beforeCursor === null) {
    const firstId = action.entries[0]?.uuid ?? null;
    hasMore = action.hasMore === true && firstId !== null;
    beforeCursor = hasMore ? firstId : null;
  }

  return {
    ...state,
    requestId: Math.max(state.requestId, action.requestId),
    entries,
    available: true,
    hasMore,
    beforeCursor,
    fileTruncated: stale ? state.fileTruncated : action.fileTruncated ?? state.fileTruncated,
  };
}
