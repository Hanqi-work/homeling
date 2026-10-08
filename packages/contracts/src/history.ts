/**
 * Wire shapes of Collie `GET /api/pane/:id/history` on bridge v1.14.2, verified against
 * `bridge/journal/types.ts:24-124` (TranscriptPart / TranscriptEntry) and `bridge/types.ts:780-798`
 * (PaneHistoryResponse), plus live captures in ./fixtures. Extra fields the bridge may add are
 * tolerated structurally; these types only name what Homeling reads.
 */

/** One renderable piece of a transcript turn. */
export type TranscriptPart =
  | { kind: "text"; text: string; truncated?: boolean }
  /** Extended thinking. Claude persists these with empty text; Codex/pi write real summaries. */
  | { kind: "thinking"; text: string; truncated?: boolean }
  | { kind: "image"; url: string; mimeType?: string }
  | {
      kind: "tool";
      name: string;
      /** One-line gist of the call's input — never the whole input. */
      summary: string;
      /** The harness's own id for this call, when it has one. */
      id?: string;
      call?: ToolCall;
      result?: ToolResult;
    };

export interface ToolResult {
  text: string;
  truncated?: boolean;
  isError?: boolean;
  imageUrl?: string;
  /** The person refused the call. NOT the same as an error: nothing went wrong, somebody said no. */
  denied?: boolean;
}

/** Structured tool call, when the adapter filled it. Additive/optional on the wire. */
export type ToolCall =
  | { kind: "execute"; command: string; exitCode?: number }
  | { kind: "edit"; path: string; added?: number; removed?: number }
  | { kind: string; [k: string]: unknown };

/** `user`/`assistant` are speech; `summary` and `note` are rendered set apart, never as speech. */
export type TranscriptRole = "user" | "assistant" | "summary" | "note";

/**
 * One turn of the conversation. `uuid` is the paging cursor and the message's stable id; `ts` is
 * ISO from the log, empty when the row carried none.
 */
export interface TranscriptEntry {
  uuid: string;
  ts: string;
  role: TranscriptRole;
  parts: TranscriptPart[];
  /** The agent rewound past this turn: not on the current branch. Views hide it. */
  abandoned?: true;
}

/** GET /api/pane/:id/history. `available:false` is a normal answer, never an error. */
export type PaneHistoryResponse =
  | { paneId: string; available: false; reason: "disabled" | "no-session" | "no-log" }
  | {
      paneId: string;
      available: true;
      /** Oldest-first. */
      entries: TranscriptEntry[];
      /** Older turns exist before `entries[0]` — page with `?before=<its uuid>`. */
      hasMore: boolean;
      total: number;
      /** The log exceeded the read cap; only its tail was parsed. */
      fileTruncated: boolean;
    };

/**
 * The subset of assistant-ui `ThreadMessageLike` Homeling renders. Kept local so contracts stays
 * UI-library-free; the adapter in apps/web maps these 1:1 onto `ThreadMessageLike`.
 */
export type UiRole = "user" | "assistant";

export interface UiTextPart {
  type: "text";
  text: string;
}

export interface UiToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  argsText: string;
  args?: Record<string, unknown>;
  resultText?: string;
  isError?: boolean;
}

export type UiContentPart = UiTextPart | UiToolCallPart;

export interface UiMessage {
  /** The transcript entry's uuid — stable across polls, immutable once seen. */
  id: string;
  role: UiRole;
  /** `ts` when the row carried one, `""` otherwise. */
  ts: string;
  content: UiContentPart[];
}
