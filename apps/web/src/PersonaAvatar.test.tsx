import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonaAvatar } from "./PersonaAvatar.tsx";
import type { PersonaView } from "@homeling/contracts";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

test("the shipped reduced-motion stylesheet disables orb animation and transform", () => {
  const window = new Window();
  try {
    const style = window.document.createElement("style");
    style.textContent = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    window.document.head.append(style);
    const media = [...style.sheet!.cssRules].find((rule) => rule.cssText.startsWith("@media (prefers-reduced-motion: reduce)"));
    expect(media).toBeDefined();
    expect(media!.cssText).toContain(".persona-thinking-orb");
    expect(media!.cssText).toContain("animation: none");
    expect(media!.cssText).toContain("transform: none");
  } finally { window.close(); }
});

const persona: PersonaView = { id: "mira", name: "Mira", avatar: { color: "#86efac" }, spaceId: "s", mainPaneId: "p", systemPrompt: "", createdAt: "2026-10-08", status: "thinking", statusSource: "agent" };

test("only fresh real thinking plays a single orb; idle, active, blocked, paused and stale remain still", () => {
  const thinking = renderToStaticMarkup(<PersonaAvatar avatar={persona.avatar} persona={persona} />);
  expect(thinking.match(/persona-thinking-orb/g)).toHaveLength(1);
  expect(thinking).toContain('role="status"');
  for (const status of ["idle", "active", "blocked"] as const) {
    expect(renderToStaticMarkup(<PersonaAvatar avatar={persona.avatar} persona={{ ...persona, status }} />)).not.toContain("persona-thinking-orb");
  }
  for (const patch of [{ paused: true }, { needsAttention: "space_missing" }, { statusSource: "missing" as const }, { statusSource: undefined }]) {
    expect(renderToStaticMarkup(<PersonaAvatar avatar={persona.avatar} persona={{ ...persona, ...patch }} />)).not.toContain("persona-thinking-orb");
  }
  expect(renderToStaticMarkup(<PersonaAvatar avatar={persona.avatar} persona={persona} stale />)).not.toContain("persona-thinking-orb");
  expect(renderToStaticMarkup(<PersonaAvatar avatar={persona.avatar} />)).not.toContain("persona-thinking-orb");
});

test("customized face and pet are identical across card, detail and conversation avatars", () => {
  const avatar = { color: "#93c5fd", character: "curious", pet: "cat" };
  for (const size of ["card", "detail", "conversation"] as const) {
    const markup = renderToStaticMarkup(<PersonaAvatar avatar={avatar} size={size} />);
    expect(markup).toContain("#93c5fd");
    expect(markup).toContain('data-character="curious"');
    expect(markup).toContain('data-pet="cat"');
  }
  const smile = renderToStaticMarkup(<PersonaAvatar avatar={{ ...avatar, character: "smile", pet: "dog" }} />);
  const curious = renderToStaticMarkup(<PersonaAvatar avatar={avatar} />);
  expect(smile.match(/<path[^>]+>/g)).not.toEqual(curious.match(/<path[^>]+>/g));
});
