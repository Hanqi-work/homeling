import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { RecordedTaskDetail } from "./ActivityTaskBoundary.tsx";

test("old occurrences show their durable identity, not the current pane's newer transcript or controls", () => {
  const markup = renderToStaticMarkup(<MemoryRouter><RecordedTaskDetail occurrence={{ occurrenceKey: "old-run", personaId: "a", spaceId: "s", paneId: "p", title: "Old build", createdAt: "2026-10-09T00:00:00Z", status: "completed" }} returnTo="/persona/a/activity" reason="This pane now belongs to a different task occurrence." /></MemoryRouter>);
  expect(markup).toContain("Old build");
  expect(markup).toContain('data-task-occurrence="old-run"');
  expect(markup).toContain("different task occurrence");
  expect(markup).toContain("Transcript cannot be reliably bound");
  expect(markup).toContain('href="/persona/a/activity"');
  expect(markup).not.toContain("Do anything");
  expect(markup).not.toContain("Stop task");
});
