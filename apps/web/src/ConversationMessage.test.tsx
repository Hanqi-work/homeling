import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { transcriptToMessages, type TranscriptEntry, type UiMessage } from "@homeling/contracts";
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toAssistantMessages } from "./assistant-messages.ts";
import { ConversationMessage } from "./ConversationMessage.tsx";

interface TranscriptProps {
  messages: UiMessage[];
}

function Transcript({ messages }: TranscriptProps): ReactElement {
  const runtime = useExternalStoreRuntime({
    messages: toAssistantMessages(messages),
    convertMessage: (message) => message,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function renderEntries(entries: TranscriptEntry[]): string {
  return renderToStaticMarkup(<Transcript messages={transcriptToMessages(entries)} />);
}

describe("ConversationMessage — external store runtime", () => {
  test("renders runtime messages with stable IDs, Markdown, tools, and timestamps", () => {
    const markup = renderEntries([
      { uuid: "user-1", ts: "2026-10-01T00:00:00Z", role: "user", parts: [{ kind: "text", text: "**hello**" }] },
      { uuid: "assistant-1", ts: "2026-10-01T00:00:01Z", role: "assistant", parts: [
        { kind: "text", text: "before tool" },
        { kind: "tool", id: "call-1", name: "Bash", summary: "run command", call: { kind: "execute", command: "pwd" }, result: { text: "tool output", isError: true } },
        { kind: "text", text: "after tool" },
      ] },
    ]);
    expect(markup).toContain('data-message-id="user-1"');
    expect(markup).toContain('data-message-id="assistant-1"');
    expect(markup).toContain("<strong>hello</strong>");
    expect(markup).toContain("bg-green-800");
    expect(markup).toContain("Bash: run command");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("pwd");
    expect(markup).toContain("tool output");
    expect(markup).toContain("tool error or denied");
    expect(markup).toContain('dateTime="2026-10-01T00:00:01Z"');
    expect(markup.indexOf("before tool")).toBeLessThan(markup.indexOf("Bash:"));
    expect(markup.indexOf("Bash:")).toBeLessThan(markup.indexOf("after tool"));
  });

  test("thinking and transcript updates keep message DOM IDs stable when older history is prepended", () => {
    const history: TranscriptEntry[] = [
      { uuid: "empty-thinking", ts: "2026-10-01T00:00:00Z", role: "assistant", parts: [{ kind: "thinking", text: "" }] },
      { uuid: "user-1", ts: "2026-10-01T00:00:01Z", role: "user", parts: [{ kind: "text", text: "question" }] },
      { uuid: "assistant-1", ts: "2026-10-01T00:00:02Z", role: "assistant", parts: [
        { kind: "thinking", text: "useful reasoning summary" },
        { kind: "text", text: "first response" },
      ] },
    ];

    const initialMessages = transcriptToMessages(history);
    expect(initialMessages.map(({ id }) => id)).toEqual(["user-1", "assistant-1"]);
    expect(initialMessages[1]?.content[0]).toEqual({ type: "text", text: "useful reasoning summary" });
    const initialMarkup = renderToStaticMarkup(<Transcript messages={initialMessages} />);
    const messageIds = (markup: string) => [...markup.matchAll(/data-message-id="([^"]+)"/g)].map((match) => match[1]);
    expect(messageIds(initialMarkup)).toEqual(["user-1", "assistant-1"]);

    const updatedParts: TranscriptEntry["parts"] = [
      { kind: "thinking", text: "useful reasoning summary" },
      { kind: "text", text: "updated response" },
    ];
    const updatedHistory: TranscriptEntry[] = [
      { uuid: "older-1", ts: "2026-10-01T00:00:00.500Z", role: "assistant", parts: [{ kind: "text", text: "older answer" }] },
      ...history.map((entry) => entry.uuid === "assistant-1" ? { ...entry, parts: updatedParts } : entry),
    ];
    const updatedMarkup = renderToStaticMarkup(<Transcript messages={transcriptToMessages(updatedHistory)} />);
    expect(messageIds(updatedMarkup)).toEqual(["older-1", "user-1", "assistant-1"]);
    expect(updatedMarkup).toContain("updated response");
    expect(updatedMarkup).not.toContain('data-message-id="empty-thinking"');
  });

  test("undated messages do not display a runtime-generated timestamp", () => {
    const markup = renderEntries([{ uuid: "undated", ts: "", role: "assistant", parts: [{ kind: "text", text: "no timestamp" }] }]);
    expect(markup).toContain('data-message-id="undated"');
    expect(markup).not.toContain("dateTime=");
    expect(markup).toMatch(/<time[^>]*><\/time>/);
  });

  test("the web adapter maps tool results without changing tool-call identity", () => {
    const messages = transcriptToMessages([
      { uuid: "turn-1", ts: "", role: "assistant", parts: [{ kind: "tool", name: "run", summary: "plain summary", result: { text: "denied result", denied: true } }] },
    ]);
    const adapted = toAssistantMessages(messages)[0]!;
    expect(adapted.id).toBe("turn-1");
    expect(adapted.content).toEqual([
      { type: "tool-call", toolCallId: "turn-1:tool:0", toolName: "run", argsText: "plain summary", args: { denied: true }, result: "denied result", isError: true },
    ]);
    const markup = renderToStaticMarkup(<Transcript messages={messages} />);
    expect(markup).toContain("denied result");
    expect(markup).toContain("tool error or denied");
  });
});
