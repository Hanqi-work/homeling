// Synthetic Collie-shaped fixture for pi-style tool calls and results.
export const fixture: unknown = {
  paneId: "w1:p2",
  available: true,
  entries: [
    {
      uuid: "pi-user-1",
      ts: "2026-10-02T10:30:00.000Z",
      role: "user",
      parts: [{ kind: "text", text: "Update the example configuration." }],
    },
    {
      uuid: "pi-assistant-1",
      ts: "2026-10-02T10:30:01.000Z",
      role: "assistant",
      parts: [
        { kind: "text", text: "I will inspect the example first." },
        {
          kind: "tool",
          name: "edit",
          summary: "config/example.ts",
          call: { kind: "edit", path: "config/example.ts", added: 2, removed: 1 },
          id: "pi-tool-call-1",
          result: { text: "Updated config/example.ts" },
        },
        { kind: "text", text: "The example configuration is updated." },
      ],
    },
  ],
  hasMore: false,
  total: 2,
  fileTruncated: false,
};
