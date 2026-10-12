import { useLocale } from "./locale.tsx";
import { MessagePrimitive, useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { ReactElement } from "react";

function TranscriptText(): ReactElement {
  return <MarkdownTextPrimitive smooth={false} />;
}

function TranscriptTool({ toolName, argsText, args, result, isError }: ToolCallMessagePartProps): ReactElement {
  const { t } = useLocale();
  return (
    <details className="rounded-lg border border-neutral-600/70 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">{toolName}: {argsText}</summary>
      {Object.keys(args).length > 0 ? <pre className="mt-2 overflow-x-auto text-neutral-300">{JSON.stringify(args, null, 2)}</pre> : null}
      {typeof result === "string" && result ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-neutral-300">{result}</pre> : null}
      {isError ? <p className="mt-1 text-red-300">{t("message.toolError")}</p> : null}
    </details>
  );
}

export function ConversationMessage(): ReactElement {
  const { t, locale } = useLocale();
  const isUser = useAuiState((state) => state.message.role === "user");
  const createdAt = useAuiState((state) => state.message.createdAt);
  const transcriptTimestamp = useAuiState((state) => state.message.metadata.custom.transcriptTimestamp);
  const timestamp = typeof transcriptTimestamp === "string" ? transcriptTimestamp : "";
  const sendStatus = useAuiState((state) => state.message.metadata.custom.sendStatus);

  return (
    <MessagePrimitive.Root asChild>
      <article className={`max-w-[88%] rounded-2xl px-4 py-3 ${isUser ? "ml-auto bg-green-800 text-white" : "mr-auto bg-neutral-800 text-neutral-100"}`}>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">{isUser ? t("message.you") : t("message.assistant")}</div>
        <div className="markdown-content flex flex-col gap-2 text-sm leading-6">
          <MessagePrimitive.Parts components={{ Text: TranscriptText, tools: { Fallback: TranscriptTool } }} />
        </div>
        <time className="mt-2 block text-right text-[10px] text-neutral-500" dateTime={timestamp || undefined}>
          {timestamp ? createdAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : ""}
        </time>
        {sendStatus === "pending" ? <p className="mt-1 text-right text-[10px] text-neutral-400">{t("delivery.pending")}</p> : null}
        {sendStatus === "sent" ? <p className="mt-1 text-right text-[10px] text-green-300">{t("delivery.sent")}</p> : null}
        {sendStatus === "unknown" ? <p className="mt-1 text-right text-[10px] text-amber-300">{t("delivery.unknown")}</p> : null}
        {sendStatus === "text-entered" ? <p className="mt-1 text-right text-[10px] text-amber-300">{t("delivery.textEntered")}</p> : null}
        {sendStatus === "failed" ? <p className="mt-1 text-right text-[10px] text-red-300">{t("delivery.failed")}</p> : null}
      </article>
    </MessagePrimitive.Root>
  );
}
