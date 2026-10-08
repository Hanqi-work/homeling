import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { PersonaView } from "@homeling/contracts";
import { PersonaLink } from "./App.tsx";

const persona: PersonaView = {
  id: "persona-1", name: "Mira", avatar: { color: "#86efac" }, spaceId: "w1",
  mainPaneId: "w1:p1", systemPrompt: "", createdAt: "2026-10-08T00:00:00Z", status: "active",
};

function renderLink(mainPaneId: string): string {
  return renderToStaticMarkup(<MemoryRouter basename="/lite" initialEntries={["/lite/"]}>
    <PersonaLink persona={{ ...persona, mainPaneId }} />
  </MemoryRouter>);
}

describe("persona conversation navigation", () => {
  test("links to the stable persona route before and after its main pane is rebuilt", () => {
    const original = renderLink("w1:p1");
    const rebuilt = renderLink("w1:p3");
    expect(original).toContain('href="/lite/persona/persona-1"');
    expect(rebuilt).toContain('href="/lite/persona/persona-1"');
    expect(rebuilt).toContain("Mira");
  });
});
