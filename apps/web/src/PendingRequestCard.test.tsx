import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingRequest } from "@homeling/contracts";
import { createSingleFlightApproval } from "./approval-guard.ts";
import { PendingRequestCard } from "./PendingRequestCard.tsx";

const promptRequest: PendingRequest = {
  id: "request:pane-a:1", paneId: "pane-a", personaId: "persona-work", kind: "prompt-select",
  payload: {
    question: "Do you want to proceed?",
    subject: ["Bash command", "rm -rf build"],
    options: [{ id: "1", label: "Allow" }, { id: "2", label: "Deny" }],
  },
  createdAt: "2026-10-08T12:00:00.000Z", status: "pending",
};

describe("PendingRequestCard", () => {
  test("renders a prompt question, context, options, and enabled buttons", () => {
    const html = renderToStaticMarkup(<PendingRequestCard request={promptRequest} onApprove={async () => ({ status: "resolved", outcome: "submitted" })} />);
    expect(html).toContain("Do you want to proceed?");
    expect(html).toContain("rm -rf build");
    expect(html).toContain("Allow");
    expect(html).toContain("Deny");
    expect(html).toContain("等待处理");
    expect(html).not.toContain("disabled=\"\"");
  });

  test("renders preview content and makes an expired request non-actionable", () => {
    const request: PendingRequest = {
      ...promptRequest,
      kind: "preview-select",
      payload: { question: "Choose a design?", options: [{ id: "1", label: "Grid" }], preview: ["┌───┐", "│ UI│"] },
      status: "expired",
    };
    const html = renderToStaticMarkup(<PendingRequestCard request={request} onApprove={async () => ({ status: "expired", outcome: "stale" })} />);
    expect(html).toContain("预览选择");
    expect(html).toContain("│ UI│");
    expect(html).toContain("已处理（请求已过期）");
    expect(html).toContain("disabled=\"\"");
  });

  test("allows retry after a failure known to have occurred before any write", async () => {
    let calls = 0;
    const approval = createSingleFlightApproval(async () => {
      calls++;
      return calls === 1
        ? { status: "pending", outcome: "not-submitted" }
        : { status: "resolved", outcome: "submitted" };
    });
    expect(await approval("1")).toEqual({ status: "pending", outcome: "not-submitted" });
    expect(await approval("1")).toEqual({ status: "resolved", outcome: "submitted" });
    expect(calls).toBe(2);
  });

  test("coalesces double taps and blocks repeat submission after the first result", async () => {
    let calls = 0;
    let release!: (value: { status: "resolved"; outcome: "submitted" }) => void;
    const approval = createSingleFlightApproval(() => {
      calls++;
      return new Promise((resolve) => { release = resolve; });
    });
    const first = approval("1");
    const second = approval("2");
    expect(calls).toBe(1);
    expect(await second).toBeNull();
    release({ status: "resolved", outcome: "submitted" });
    expect(await first).toEqual({ status: "resolved", outcome: "submitted" });
    expect(await approval("1")).toBeNull();
    expect(calls).toBe(1);
  });
});
