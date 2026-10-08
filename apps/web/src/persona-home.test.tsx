import { expect, test } from "bun:test";
import type { PaneHistoryResponse, PersonaView } from "@homeling/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { App, PersonaLink } from "./App.tsx";
import { latestPersonaLine } from "./persona-home.ts";

const persona: PersonaView = { id: "mira", name: "Mira", avatar: { color: "#86efac" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "idle" };
test("homepage shows the latest spoken text, not hidden thinking or abandoned turns", () => {
  const history: PaneHistoryResponse = { paneId: "p", available: true, hasMore: false, total: 3, fileTruncated: false, entries: [
    { uuid: "1", ts: "1", role: "assistant", parts: [{ kind: "text", text: "Your plan is ready." }] },
    { uuid: "2", ts: "2", role: "assistant", parts: [{ kind: "thinking", text: "private reasoning" }] },
    { uuid: "3", ts: "3", role: "assistant", abandoned: true, parts: [{ kind: "text", text: "discarded" }] },
  ] };
  expect(latestPersonaLine(history)).toBe("Your plan is ready.");
  const html = renderToStaticMarkup(<MemoryRouter><PersonaLink persona={persona} preview={latestPersonaLine(history)} /></MemoryRouter>);
  expect(html).toContain("Your plan is ready.");
  expect(html).toContain("Idle");
  expect(html).not.toContain("Thinking");
});

test("bottom navigation exposes separate creation and composable settings routes", () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/settings"]}><App slots={{ settings: <><p>Push preferences</p><p>Session lock</p></> }} /></MemoryRouter>);
  expect(html).toContain('href="/new"');
  expect(html).toContain('href="/settings"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("Push preferences");
  expect(html).toContain("Session lock");
  expect(html).not.toContain("All panes");
});
