import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { PersonaView } from "@homeling/contracts";
import { PersonaDetailContent } from "./PersonaDetail.tsx";
const persona: PersonaView = { id: "mira", name: "Mira", avatar: { color: "#86efac" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "blocked" };
test("persona panel exposes local computer and honest resource lifecycle before deletion", () => {
  const html = renderToStaticMarkup(<MemoryRouter><PersonaDetailContent persona={persona} /></MemoryRouter>);
  expect(html).toContain("Computers");
  expect(html).toContain("This computer");
  expect(html).toContain("Blocked · needs you");
  expect(html).toContain('href="/persona/mira/memory"');
  expect(html).toContain('href="/persona/mira/activity"');
  expect(html).toContain('href="/persona/mira/customize"');
  expect(html).toContain("closes the main conversation pane");
  expect(html).toContain("Task panes keep running");
  expect(html).toContain("space is retained as an archive");
  expect(html).not.toContain("online");
});
