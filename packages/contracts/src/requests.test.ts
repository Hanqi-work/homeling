import { describe, expect, test } from "bun:test";
import { transitionRequest, upsertPendingRequest, type PendingRequest } from "./requests.ts";

const prompt: PendingRequest = {
  id: "req:pane-1:rev-42",
  paneId: "pane-1",
  personaId: "persona-work",
  kind: "prompt-select",
  payload: {
    question: "Allow this command?",
    options: [{ id: "1", label: "Allow" }, { id: "2", label: "Deny" }],
  },
  createdAt: "2026-10-08T12:00:00.000Z",
  status: "pending",
};

describe("pending request contract", () => {
  test("upserts the same stable request id once", () => {
    const first = upsertPendingRequest([], prompt);
    const repeated = upsertPendingRequest(first, { ...prompt, payload: { ...prompt.payload, question: "Changed after duplicate observation" } });
    expect(first).toHaveLength(1);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.id).toBe(prompt.id);
    expect(repeated[0]?.createdAt).toBe(prompt.createdAt);
    expect(repeated[0]?.payload).toEqual({ ...prompt.payload, question: "Changed after duplicate observation" });
  });

  test("only explicit not-submitted evidence revives a resolved request", () => {
    const resolved = transitionRequest([prompt], prompt.id, "resolved");
    expect(upsertPendingRequest(resolved, prompt)[0]?.status).toBe("resolved");
    const retryable = upsertPendingRequest(resolved, prompt, { outcome: "not-submitted" });
    expect(retryable[0]?.status).toBe("pending");
    expect(retryable[0]?.createdAt).toBe(prompt.createdAt);
    const expired = transitionRequest([prompt], prompt.id, "expired");
    expect(upsertPendingRequest(expired, prompt, { outcome: "not-submitted" })[0]?.status).toBe("expired");
  });

  test("only pending requests can transition to a terminal status", () => {
    expect(transitionRequest([prompt], prompt.id, "resolved")[0]?.status).toBe("resolved");
    expect(transitionRequest([prompt], prompt.id, "expired")[0]?.status).toBe("expired");
    const resolved = transitionRequest([prompt], prompt.id, "resolved");
    expect(transitionRequest(resolved, prompt.id, "expired")).toEqual(resolved);
    expect(transitionRequest([prompt], "missing", "resolved")).toEqual([prompt]);
  });

  test("preview-select payload includes display content and an approval key", () => {
    const preview: PendingRequest = {
      ...prompt,
      id: "req:pane-1:rev-43",
      kind: "preview-select",
      payload: {
        question: "Choose a layout?",
        options: [{ id: "1", label: "Grid" }],
        preview: ["┌───┐", "│ UI│", "└───┘"],
      },
    };
    expect(preview.kind).toBe("preview-select");
    if (preview.kind === "preview-select") expect(preview.payload.preview).toContain("│ UI│");
  });
});
