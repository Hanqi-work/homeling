// Synthetic Collie-shaped fixture for Claude-style text, tool, note, and summary rows.
export const fixture: unknown = {
  paneId: "w1:p1",
  available: true,
  entries: [
    {
      uuid: "claude-user-1",
      ts: "2026-10-01T09:00:00.000Z",
      role: "user",
      parts: [{ kind: "text", text: "Summarize the latest changes as a short list." }],
    },
    {
      uuid: "claude-thinking-1",
      ts: "2026-10-01T09:00:01.000Z",
      role: "assistant",
      parts: [{ kind: "thinking", text: "Review the available change summary." }],
    },
    {
      uuid: "claude-tool-1",
      ts: "2026-10-01T09:00:02.000Z",
      role: "assistant",
      parts: [{
        kind: "tool",
        name: "Bash",
        summary: "Read the change summary",
        call: { kind: "execute", command: "git status --short" },
        id: "tool-call-1",
        result: { text: " M src/example.ts" },
      }],
    },
    {
      uuid: "claude-answer-1",
      ts: "2026-10-01T09:00:03.000Z",
      role: "assistant",
      parts: [{ kind: "text", text: "- Updated the example.\n- Added a focused test." }],
    },
    {
      uuid: "claude-note-1",
      ts: "2026-10-01T09:00:04.000Z",
      role: "note",
      parts: [{ kind: "text", text: "Background task completed." }],
    },
    {
      uuid: "claude-summary-1",
      ts: "2026-10-01T09:00:05.000Z",
      role: "summary",
      parts: [{ kind: "text", text: "Earlier conversation summary." }],
    },
  ],
  hasMore: false,
  total: 6,
  fileTruncated: false,
};
