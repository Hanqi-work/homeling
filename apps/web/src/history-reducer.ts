import { mergeTranscripts, type TranscriptEntry } from "@homeling/contracts";

export interface OutgoingMessage {
  readonly id: string;
  readonly text: string;
  readonly sentAt: number;
  /** Monotonic order of the latest send attempt, including retries. */
  readonly attemptOrder: number;
  readonly retryQueued?: boolean;
  readonly status: "pending" | "sent" | "failed";
  readonly matchedUuid?: string;
  readonly matchedAt?: number;
  readonly textDelivered?: boolean;
  readonly deliveryUnknown?: boolean;
}

export interface HistoryState {
  readonly paneId: string;
  /** Highest request sequence started for this pane; stale responses may still add unseen entries. */
  readonly requestId: number;
  readonly entries: TranscriptEntry[];
  readonly outgoing: OutgoingMessage[];
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
  | { type: "unavailable"; paneId: string; requestId: number }
  | { type: "outgoing-added"; paneId: string; id: string; text: string; sentAt: number; attemptOrder?: number }
  | { type: "outgoing-failed"; paneId: string; id: string; textDelivered: boolean | null }
  | { type: "outgoing-retry"; paneId: string; id: string }
  | { type: "outgoing-attempt-started"; paneId: string; id: string; attemptOrder: number };

export function initialHistoryState(paneId: string): HistoryState {
  return {
    paneId,
    requestId: 0,
    entries: [],
    outgoing: [],
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
function entryText(entry: TranscriptEntry): string {
  return entry.parts.filter((part) => part.kind === "text").map((part) => part.text).join("");
}

export function reconcileOutgoing(outgoing: OutgoingMessage[], entries: TranscriptEntry[]): OutgoingMessage[] {
  const used = new Set(outgoing.flatMap((message) => message.matchedUuid ? [message.matchedUuid] : []));
  const ordered = [...outgoing].sort((left, right) => left.attemptOrder - right.attemptOrder);
  const nextById = new Map<string, OutgoingMessage>();
  let cursor = -1;
  let cursorTimestamp = Number.NEGATIVE_INFINITY;
  let blocked = false;
  let changed = false;

  for (const message of ordered) {
    let nextMessage = message;
    if (message.matchedUuid) {
      const matchedIndex = entries.findIndex((entry) => entry.uuid === message.matchedUuid);
      if (matchedIndex > cursor) cursor = matchedIndex;
      const matchedTimestamp = message.matchedAt ?? (matchedIndex >= 0 ? Date.parse(entries[matchedIndex]!.ts) : Number.NaN);
      if (Number.isFinite(matchedTimestamp)) cursorTimestamp = Math.max(cursorTimestamp, matchedTimestamp);
    } else {
      const knownNotDelivered = (message.status === "failed" || message.retryQueued === true) &&
        message.textDelivered !== true && message.deliveryUnknown !== true;
      if (message.retryQueued && knownNotDelivered) blocked = true;
      if (!blocked && !knownNotDelivered) {
        const matchIndex = entries.findIndex((entry, index) => {
          if (index <= cursor || entry.role !== "user" || entry.abandoned === true || used.has(entry.uuid)) return false;
          const timestamp = Date.parse(entry.ts);
          return Number.isFinite(timestamp) && timestamp >= Math.max(message.sentAt, cursorTimestamp) && entryText(entry) === message.text;
        });
        if (matchIndex === -1) {
          blocked = true;
        } else {
          const match = entries[matchIndex]!;
          const matchedAt = Date.parse(match.ts);
          used.add(match.uuid);
          cursor = matchIndex;
          cursorTimestamp = Math.max(cursorTimestamp, matchedAt);
          changed = true;
          nextMessage = {
            ...message, status: "sent", matchedUuid: match.uuid, matchedAt,
            textDelivered: undefined, deliveryUnknown: false,
          };
        }
      }
    }
    nextById.set(message.id, nextMessage);
  }

  return changed ? outgoing.map((message) => nextById.get(message.id) ?? message) : outgoing;
}

export function optimisticEntries(state: HistoryState): TranscriptEntry[] {
  return state.outgoing
    .filter((message) => !message.matchedUuid)
    .map((message) => ({
      uuid: message.id,
      ts: new Date(message.sentAt).toISOString(),
      role: "user",
      parts: [{ kind: "text", text: message.text }],
    }));
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.paneId !== state.paneId) return state;
  if (action.type === "outgoing-added") {
    if (state.outgoing.some((message) => message.id === action.id)) return state;
    const attemptOrder = action.attemptOrder ?? Math.max(-1, ...state.outgoing.map((message) => message.attemptOrder)) + 1;
    return { ...state, outgoing: [...state.outgoing, {
      id: action.id, text: action.text, sentAt: action.sentAt, attemptOrder, status: "pending",
    }] };
  }
  if (action.type === "outgoing-failed" || action.type === "outgoing-retry" || action.type === "outgoing-attempt-started") {
    return {
      ...state,
      outgoing: state.outgoing.map((message) => {
        if (message.id !== action.id || message.matchedUuid) return message;
        if (action.type === "outgoing-retry") {
          return { ...message, status: "pending", retryQueued: true };
        }
        if (action.type === "outgoing-attempt-started") {
          return { ...message, status: "pending", retryQueued: false, attemptOrder: action.attemptOrder };
        }
        return {
          ...message,
          status: "failed",
          retryQueued: false,
          textDelivered: message.textDelivered === true || action.textDelivered === true,
          deliveryUnknown: message.deliveryUnknown === true || action.textDelivered === null,
        };
      }),
    };
  }
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
    outgoing: reconcileOutgoing(state.outgoing, entries),
    available: true,
    hasMore,
    beforeCursor,
    fileTruncated: stale ? state.fileTruncated : action.fileTruncated ?? state.fileTruncated,
  };
}
