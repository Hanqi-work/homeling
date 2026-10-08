import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { ActivityResponse } from "@homeling/contracts";
import { ActivityTimeline } from "./ActivityPanel.tsx";

const activity: ActivityResponse = {
  observation: "gap",
  occurrences: [{ occurrenceKey: "run-1", personaId: "persona-a", spaceId: "space-a", paneId: "w2:p1", title: "Build the garden", createdAt: "2026-10-09T00:00:00.000Z", status: "unknown" }],
  events: [{ id: "event-1", sequence: 1, dedupeKey: "run-1:task.unknown", kind: "task.unknown", personaId: "persona-a", paneId: "w2:p1", occurrenceKey: "run-1", occurredAt: "2026-10-09T00:00:00.000Z", source: "daemon.observer", detail: "Pane exited without a known outcome" }],
};

test("Activity rows link to the actual pane detail with a distinct occurrence and truthful gaps", () => {
  const markup = renderToStaticMarkup(<MemoryRouter><ActivityTimeline activity={activity} personaId="persona-a" /></MemoryRouter>);
  expect(markup).toContain('href="/t/w2%3Ap1?occurrence=run-1"');
  expect(markup).toContain("Build the garden");
  expect(markup).toContain("Outcome unknown");
  expect(markup).toContain("Observation gap");
  expect(markup).toContain("Pane exited without a known outcome");
  expect(markup).toContain("<time");
  expect(markup).not.toContain("Task failed");
});

test("empty history stays empty and foreign persona rows never leak into the panel", () => {
  const markup = renderToStaticMarkup(<MemoryRouter><ActivityTimeline activity={activity} personaId="persona-b" /></MemoryRouter>);
  expect(markup).toContain("No recorded activity yet");
  expect(markup).not.toContain("Build the garden");
  expect(markup).not.toContain("/t/w2");
});
