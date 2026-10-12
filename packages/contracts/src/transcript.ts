/**
 * Mapping + merging of Collie transcript pages into the message array assistant-ui renders
 * (ADR-0003: polling with immutable replacement; ADR-0004: no Collie writes).
 */
import type {
  PaneHistoryResponse,
  TranscriptEntry,
  TranscriptPart,
  UiContentPart,
  UiMessage,
} from "./history.ts";

export type { PaneHistoryResponse };

/** The speech roles. `summary`/`note` are machine content and never become chat bubbles. */
const SPEECH_ROLES = new Set(["user", "assistant"]);

function compareTimestamp(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function partToContent(part: TranscriptPart, entryUuid: string, index: number): UiContentPart | null {
  switch (part.kind) {
    case "text":
      return part.text ? { type: "text", text: part.text } : null;
    case "thinking":
      // Claude Code persists thinking blocks with the text stripped — an empty string renders as
      // noise, so it drops. Harnesses that write real reasoning summaries come through as text.
      return part.text ? { type: "text", text: part.text } : null;
    case "tool": {
      const args: Record<string, unknown> = {};
      if (part.call?.kind === "execute" && typeof part.call.command === "string") args.command = part.call.command;
      if (part.call?.kind === "edit" && typeof part.call.path === "string") args.path = part.call.path;
      if (part.result?.denied) args.denied = true;
      return {
        type: "tool-call",
        // The harness's id where it has one; a derived one keeps the part identity stable even
        // when a call's result lands in a later read of the same row.
        toolCallId: part.id ?? `${entryUuid}:tool:${index}`,
        toolName: part.name,
        argsText: part.summary,
        args: Object.keys(args).length > 0 ? args : undefined,
        resultText: part.result?.text || undefined,
        isError: part.result?.isError === true || part.result?.denied === true,
      };
    }
    default:
      // `image` parts are not part of v1's renderable subset (PRD: text-first stream).
      return null;
  }
}

/**
 * Map one page of transcript entries into renderable messages, oldest-first.
 *
 * - `abandoned` turns are hidden (the transcript's own convention: views hide them, cursors don't).
 * - `summary`/`note` entries are machine content, not speech — they never become bubbles.
 * - An entry with no renderable parts produces no message rather than an empty bubble.
 * - Message ids ARE the entry uuids: stable across polls, replaced immutably.
 */
export function transcriptToMessages(entries: TranscriptEntry[]): UiMessage[] {
  const messages: UiMessage[] = [];
  const seen = new Set<string>();
  const ordered = [...entries].sort((a, b) => compareTimestamp(a.ts, b.ts));
  for (const entry of ordered) {
    if (seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    if (entry.abandoned) continue;
    if (!SPEECH_ROLES.has(entry.role)) continue;
    const content = entry.parts
      .map((part, i) => partToContent(part, entry.uuid, i))
      .filter((p): p is UiContentPart => p !== null);
    if (content.length === 0) continue;
    messages.push({
      id: entry.uuid,
      role: entry.role === "user" ? "user" : "assistant",
      ts: entry.ts,
      content,
    });
  }
  return messages;
}

/**
 * Merge overlapping history reads oldest-first. The newest occurrence of a UUID replaces its
 * contents, while Map insertion order provides a stable tie-breaker for equal timestamps.
 */
export function mergeTranscripts(pages: TranscriptEntry[][]): TranscriptEntry[] {
  const byId = new Map<string, TranscriptEntry>();
  for (const page of pages) {
    for (const entry of page) byId.set(entry.uuid, entry);
  }
  return [...byId.values()].sort((a, b) => compareTimestamp(a.ts, b.ts));
}
