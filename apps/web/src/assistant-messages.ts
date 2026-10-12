import type { ThreadMessageLike, ToolCallMessagePart } from "@assistant-ui/react";
import type { UiMessage } from "@homeling/contracts";

export function toAssistantMessages(messages: UiMessage[], sendStatuses: ReadonlyMap<string, string> = new Map()): ThreadMessageLike[] {
  return messages.map(function (message) {
    return {
      id: message.id,
      role: message.role,
      createdAt: message.ts ? new Date(message.ts) : undefined,
      metadata: { custom: { transcriptTimestamp: message.ts, sendStatus: sendStatuses.get(message.id) } },
      content: message.content.map(function (part) {
        if (part.type === "text") return part;
        return {
          type: part.type,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          argsText: part.argsText,
          args: (part.args as ToolCallMessagePart["args"] | undefined) ?? {},
          result: part.resultText,
          isError: part.isError,
        };
      }),
    };
  });
}
