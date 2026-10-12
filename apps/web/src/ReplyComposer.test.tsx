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
    expect(markup).toContain('aria-label="Quick replies"');
    const quickButtons = markup.match(/<button[^>]+class="[^"]*rounded-full[^"]*"/g) ?? [];
    expect(quickButtons).toHaveLength(3);
    for (const button of quickButtons) expect(button).toContain("min-h-11");
    expect(markup).toContain('id="reply-draft"');
    expect(markup).toContain("<textarea");
    expect(markup).toContain(">Send</button>");
    for (const phrase of ["I&amp;#x27;ll take a look", "Please continue", "Pause until I confirm"]) expect(markup).toContain(phrase.replace("&amp;#x27;", "&#x27;"));
  });

  test("locks the composer when a previous input is awaiting a safe retry", () => {
    const markup = renderToStaticMarkup(<ReplyComposer draft="draft" onDraftChange={() => {}} onSend={() => {}} disabled />);
    expect(markup).toContain("Retry the unconfirmed message");
    expect(markup.match(/disabled=""/g)?.length).toBe(6);
  });

  test("uncertain cancellation locks preserve draft and never invite a retry", () => {
    const markup = renderToStaticMarkup(<ReplyComposer draft="keep my draft" onDraftChange={() => {}} onSend={() => {}} disabled disabledReason="取消键在途或结果未知；请检查终端，不要刷新后重试。" />);
    expect(markup).toContain("keep my draft");
    expect(markup).toContain("不要刷新后重试");
    expect(markup).not.toContain("Retry the unconfirmed message");
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
