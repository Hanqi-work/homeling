import { describe, expect, test } from "bun:test";
import { fixture as claudeHistory } from "./fixtures/pane-history-claude.ts";
import { fixture as piHistory } from "./fixtures/pane-history-pi.ts";
import type { PaneHistoryResponse, TranscriptEntry } from "./history.ts";
import { transcriptToMessages } from "./transcript.ts";

function entriesOf(history: unknown): TranscriptEntry[] {
  const response = history as PaneHistoryResponse;
  if (!response.available) throw new Error("fixture history must be available");
  return response.entries;
}

describe("transcriptToMessages — wire-shaped fixtures", () => {
  test("claude pane: user/assistant/note roles map to assistant-ui ThreadMessageLike", () => {
    const messages = transcriptToMessages(entriesOf(claudeHistory));
    const roles = messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    // No note entry may masquerade as speech.
    for (const m of messages) expect(m.role === "user" || m.role === "assistant").toBe(true);
    // All content is string parts — the exact renderable subset.
    for (const m of messages) {
      expect(Array.isArray(m.content)).toBe(true);
      for (const part of m.content as Array<{ type: string }>) {
        expect(["text", "tool-call"]).toContain(part.type);
      }
    }
  });

  test("pi pane: tool parts become tool-call content with argsText and result", () => {
    const messages = transcriptToMessages(entriesOf(piHistory));
    const toolParts = messages.flatMap((m) => m.content.filter((part) => part.type === "tool-call"));
    expect(toolParts.length).toBeGreaterThan(0);
    for (const part of toolParts) {
      expect(typeof part.toolName).toBe("string");
      expect(typeof part.toolCallId).toBe("string");
      expect(typeof part.argsText).toBe("string");
      expect(typeof part.resultText).toBe("string");
    }
  });

  test("deduplicates UUIDs and sorts messages by timestamp without splitting multi-part turns", () => {
    const messages = transcriptToMessages([
      { uuid: "late", ts: "2026-10-01T00:00:02Z", role: "assistant", parts: [{ kind: "text", text: "later" }] },
      { uuid: "early", ts: "2026-10-01T00:00:01Z", role: "assistant", parts: [
        { kind: "text", text: "before" },
        { kind: "tool", name: "Bash", summary: "run command", id: "call-1", call: { kind: "execute", command: "pwd" } },
        { kind: "text", text: "after" },
      ] },
      { uuid: "late", ts: "2026-10-01T00:00:02Z", role: "assistant", parts: [{ kind: "text", text: "duplicate" }] },
    ]);

    expect(messages.map((m) => m.id)).toEqual(["early", "late"]);
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "before" },
      { type: "tool-call", toolCallId: "call-1", toolName: "Bash", argsText: "run command", args: { command: "pwd" }, isError: false },
      { type: "text", text: "after" },
    ]);
  });
});

describe("transcriptToMessages — edge cases", () => {
  test("abandoned entries are hidden", () => {
    const messages = transcriptToMessages([
      { uuid: "a", ts: "2026-10-07T13:00:00Z", role: "user", parts: [{ kind: "text", text: "hi" }] },
      { uuid: "b", ts: "2026-10-07T13:00:05Z", role: "assistant", parts: [{ kind: "text", text: "old branch" }], abandoned: true },
      { uuid: "c", ts: "2026-10-07T13:00:10Z", role: "assistant", parts: [{ kind: "text", text: "new branch" }] },
    ]);
    expect(messages.map((m) => m.id)).toEqual(["a", "c"]);
  });

  test("thinking parts with content surface as text; empty ones (Claude strips them) drop", () => {
    const messages = transcriptToMessages([
      { uuid: "a", ts: "", role: "assistant", parts: [{ kind: "thinking", text: "" }, { kind: "thinking", text: "reasoning here" }, { kind: "text", text: "answer" }] },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toEqual([
      { type: "text", text: "reasoning here" },
      { type: "text", text: "answer" },
    ]);
  });

  test("an entry with no renderable parts produces no message", () => {
    const messages = transcriptToMessages([
      { uuid: "a", ts: "", role: "assistant", parts: [] },
      { uuid: "b", ts: "", role: "assistant", parts: [{ kind: "text", text: "x" }] },
    ]);
    expect(messages.map((m) => m.id)).toEqual(["b"]);
  });

  test("denied tool results stay distinguishable from error results", () => {
    const messages = transcriptToMessages([
      {
        uuid: "a", ts: "", role: "assistant",
        parts: [
          { kind: "tool", name: "write", summary: "f.ts", id: "t1", result: { text: "no", denied: true } },
          { kind: "tool", name: "run", summary: "x", id: "t2", result: { text: "boom", isError: true } },
        ],
      },
    ]);
    const parts = messages[0]!.content;
    expect(parts[0]?.type).toBe("tool-call");
    expect(parts[1]?.type).toBe("tool-call");
    if (parts[0]?.type === "tool-call" && parts[1]?.type === "tool-call") {
      expect(parts[0].isError).toBe(true);
      expect(parts[0].args).toMatchObject({ denied: true });
      expect(parts[1].isError).toBe(true);
      expect(parts[1].args).toBeUndefined();
    }
  });
});
