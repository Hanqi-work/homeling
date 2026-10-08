import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Task } from "@homeling/contracts";
import { TaskChip } from "./TaskChip.tsx";

const task: Task = {
  paneId: "w2:p1",
  launcher: { command: "bun test", label: "Test suite" },
  createdAt: 1,
  status: "working",
};

describe("TaskChip", () => {
  test("renders bridge pane id as stable task identity and working status", () => {
    const markup = renderToStaticMarkup(<TaskChip task={task} />);
    expect(markup).toContain('data-task-id="w2:p1"');
    expect(markup).toContain("◍");
    expect(markup).toContain("Test suite");
    expect(markup).toContain("working");
  });

  test("uses the idle marker and explicit non-working status", () => {
    const markup = renderToStaticMarkup(<TaskChip task={{ ...task, status: "blocked" }} />);
    expect(markup).toContain("○");
    expect(markup).toContain("blocked");
    expect(markup).not.toContain("◍");
  });
});
