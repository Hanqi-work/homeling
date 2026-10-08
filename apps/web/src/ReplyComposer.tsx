import type { FormEvent, ReactElement } from "react";

export const QUICK_REPLIES = ["我马上看一下", "请继续", "先暂停，等我确认"] as const;

interface ReplyComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function submitComposerDraft(draft: string, onSend: () => void): void {
  if (draft.trim()) onSend();
}

export function selectQuickReply(phrase: string, onDraftChange: (value: string) => void): void {
  onDraftChange(phrase);
}

export function handleComposerKeyDown(
  event: { key: string; shiftKey: boolean; isComposing: boolean; preventDefault: () => void },
  submit: () => void,
): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (event.isComposing) return;
  submit();
}

export function ReplyComposer({ draft, onDraftChange, onSend, disabled = false }: ReplyComposerProps): ReactElement {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!disabled) submitComposerDraft(draft, onSend);
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-neutral-800 bg-[#1a1a1a] pt-3">
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="快捷回复">
        {QUICK_REPLIES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            disabled={disabled}
            onClick={() => selectQuickReply(phrase, onDraftChange)}
            className="shrink-0 rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-green-700 hover:text-green-200"
          >
            {phrase}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="reply-draft">回复消息</label>
      <div className="flex items-end gap-2">
        <textarea
          id="reply-draft"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={(event) => handleComposerKeyDown({
            key: event.key,
            shiftKey: event.shiftKey,
            isComposing: event.nativeEvent.isComposing,
            preventDefault: () => event.preventDefault(),
          }, () => { if (!disabled) submitComposerDraft(draft, onSend); })}
          disabled={disabled}
          rows={2}
          placeholder="输入消息…"
          className="min-h-12 min-w-0 flex-1 resize-y rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-green-700 focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="rounded-xl bg-green-700 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {disabled ? <p className="mt-1 text-xs text-amber-300" role="status">请先重试尚未确认的消息，再发送新消息。</p> : null}
      <p className="mt-1 text-right text-[10px] text-neutral-500">Enter 发送 · Shift+Enter 换行</p>
    </form>
  );
}
