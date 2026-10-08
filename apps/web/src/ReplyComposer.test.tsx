import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  handleComposerKeyDown,
  QUICK_REPLIES,
  ReplyComposer,
  selectQuickReply,
  submitComposerDraft,
} from "./ReplyComposer.tsx";

describe("ReplyComposer", () => {
  test("renders a labeled multiline composer, explicit send button, and quick reply chips", () => {
    const markup = renderToStaticMarkup(<ReplyComposer draft="draft" onDraftChange={() => {}} onSend={() => {}} />);
    expect(markup).toContain('aria-label="快捷回复"');
    expect(markup).toContain('id="reply-draft"');
    expect(markup).toContain("<textarea");
    expect(markup).toContain(">Send</button>");
    for (const phrase of QUICK_REPLIES) expect(markup).toContain(phrase);
  });

  test("locks the composer when a previous input is awaiting a safe retry", () => {
    const markup = renderToStaticMarkup(<ReplyComposer draft="draft" onDraftChange={() => {}} onSend={() => {}} disabled />);
    expect(markup).toContain("请先重试尚未确认的消息");
    expect(markup.match(/disabled=""/g)?.length).toBe(6);
  });

  test("quick replies fill the draft without sending", () => {
    let draft = "";
    let sends = 0;
    selectQuickReply(QUICK_REPLIES[0], (value) => { draft = value; });
    expect(draft).toBe(QUICK_REPLIES[0]);
    expect(sends).toBe(0);
    submitComposerDraft(draft, () => { sends += 1; });
    expect(sends).toBe(1);
  });

  test("Enter submits, Shift+Enter preserves a newline, and IME composition is not submitted", () => {
    let submits = 0;
    let prevented = 0;
    const keyboardEvent = (options: { key: string; shiftKey?: boolean; isComposing?: boolean }) => ({
      key: options.key,
      shiftKey: options.shiftKey ?? false,
      isComposing: options.isComposing ?? false,
      preventDefault: () => { prevented += 1; },
    });

    handleComposerKeyDown(keyboardEvent({ key: "Enter" }), () => { submits += 1; });
    expect(submits).toBe(1);
    expect(prevented).toBe(1);

    handleComposerKeyDown(keyboardEvent({ key: "Enter", shiftKey: true }), () => { submits += 1; });
    expect(submits).toBe(1);
    expect(prevented).toBe(1);

    handleComposerKeyDown(keyboardEvent({ key: "Enter", isComposing: true }), () => { submits += 1; });
    expect(submits).toBe(1);
    expect(prevented).toBe(2);
  });
});
