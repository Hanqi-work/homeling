import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Task } from "@homeling/contracts";
import { MemoryRouter } from "react-router";
import { TaskChip } from "./TaskChip.tsx";

const task: Task = {
  paneId: "w2:p1",
  launcher: { command: "bun test", label: "Test suite" },
  createdAt: 1,
  status: "working",
};

describe("TaskChip", () => {
  test("renders bridge pane id as stable task identity and working status", () => {
    const markup = renderToStaticMarkup(<MemoryRouter><TaskChip task={task} /></MemoryRouter>);
    expect(markup).toContain('data-task-id="w2:p1"');
    expect(markup).toContain('href="/t/w2%3Ap1"');
    expect(markup).toContain("◍");
    expect(markup).toContain("Test suite");
    expect(markup).toContain("working");
  });

  test("uses the idle marker and explicit non-working status", () => {
    const markup = renderToStaticMarkup(<MemoryRouter><TaskChip task={{ ...task, status: "blocked" }} /></MemoryRouter>);
    expect(markup).toContain("○");
    expect(markup).toContain("blocked");
    expect(markup).not.toContain("◍");
  });
});
