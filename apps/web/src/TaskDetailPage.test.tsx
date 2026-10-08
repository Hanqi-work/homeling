import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Task } from "@homeling/contracts";
import { ReplyComposer } from "./ReplyComposer.tsx";
import { createTaskSendQueue, enqueueTaskSend } from "./task-detail.ts";
import { TaskDetailPage } from "./TaskDetailPage.tsx";

const task: Task = {
  paneId: "w2:p1",
  launcher: { command: "bun test", label: "Test suite" },
  createdAt: Date.now() - 60_000,
  status: "working",
};

function renderTask(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[{ pathname: "/t/w2:p1", state: { task, returnTo: "/p/w1%3Ap1" } }]}>
      <Routes><Route path="/t/:paneId" element={<TaskDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("TaskDetailPage", () => {
  test("shows task transcript shell, runtime, mirror entry, reply, and confirm-gated stop", () => {
    const html = renderTask();
    expect(html).toContain("Test suite");
    expect(html).toContain("Working for");
    expect(html).toContain("View raw pane output");
    expect(html).toContain("Stop task");
    expect(html).toContain("输入消息");
    expect(html).not.toContain("Confirm interrupt");
    expect(html).toContain('href="/p/w1%3Ap1"');
  });

  test("partial send locks B until retry succeeds, then restores composer without marking delivery", async () => {
    const queue = createTaskSendQueue();
    const requests: string[] = [];
    let inputBuffer = "";
    let historyAvailable = false;
    let releaseB!: () => void;
    const bSent = new Promise<void>((resolve) => { releaseB = resolve; });

    await expect(enqueueTaskSend(queue, "A", () => false, async () => {
      inputBuffer += "A";
      requests.push("type A", "submit A failed");
      throw new Error("submit failed after text entered");
    }).catch((error: unknown) => { queue.block("A"); throw error; })).rejects.toThrow("submit failed after text entered");

    const locked = renderToStaticMarkup(<ReplyComposer draft="B" onDraftChange={() => {}} onSend={() => {}} disabled={queue.isBlocked()} />);
    expect(locked).toContain("请先重试尚未确认的消息");
    expect(locked).toMatch(/<textarea[^>]*disabled=""/);

    await enqueueTaskSend(queue, "B", () => false, async () => {
      inputBuffer += "B";
      requests.push("type B");
      releaseB();
    });
    expect(requests).toEqual(["type A", "submit A failed"]);
    expect(inputBuffer).toBe("A");

    await enqueueTaskSend(queue, "A", () => false, async () => {
      requests.push("retry A submit");
      inputBuffer = "";
      queue.unblock("A");
    });
    await bSent;
    const unlocked = renderToStaticMarkup(<ReplyComposer draft="next" onDraftChange={() => {}} onSend={() => {}} disabled={queue.isBlocked()} />);
    expect(unlocked).not.toMatch(/<textarea[^>]*disabled=""/);
    expect(requests).toEqual(["type A", "submit A failed", "retry A submit", "type B"]);
    expect(inputBuffer).toBe("B");
    expect(historyAvailable).toBe(false);
    expect(queue.isBlocked()).toBe(false);
  });
});
