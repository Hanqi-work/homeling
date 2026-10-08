import { expect, test } from "bun:test";
import { memoryInjectionPlan } from "./memory-injection.ts";

test("pi layers Markdown through its supported startup flag; other kinds explicitly fall back", () => {
  const documents = { facts: { content: "Lives in Guangzhou", revision: "f" }, preferences: { content: "Keep replies short", revision: "p" }, project: { content: "Build a garden", revision: "g" } };
  const pi = memoryInjectionPlan("pi --model test", "Be kind", { documents, effective: "next-session" });
  expect(pi.strategy).toBe("pi-append-system-prompt");
  expect(pi.context).toContain("Lives in Guangzhou");
  expect(pi.context).toContain("Keep replies short");
  expect(pi.context).toContain("Build a garden");
  const claude = memoryInjectionPlan("claude", "Be kind", { documents, effective: "next-session" });
  expect(claude.strategy).toBe("first-message-prefix");
  expect(claude.unsupported).toBe(true);
  expect(claude.notice).toContain("unsupported");
  expect(memoryInjectionPlan("pi && echo surprise", "", { documents, effective: "next-session" }).unsupported).toBe(true);
  expect(memoryInjectionPlan("pi\n--model test", "", { documents, effective: "next-session" }).unsupported).toBe(true);
});
