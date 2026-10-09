import { expect, test } from "bun:test";
import { LOCALES, translate } from "./locale.tsx";
import { localeResources } from "./locale-resources.ts";
import { latestPersonaPreview } from "./persona-home.ts";

test("all wire task statuses have UI copy, including done", () => {
  expect(translate("en", "task.done")).toBe("done");
  expect(translate("ja", "task.done")).toBe("完了");
});
test("unknown keys remain visible and interpolation does not reinterpret replacement values", () => {
  expect(translate("zh", "future.key")).toBe("future.key");
  expect(translate("de", "persona.about", { name: "$& {count}" })).toBe("Über $& {count}");
});
test("every registered locale has every shipped key and identical interpolation parameters", () => {
  const expected = Object.keys(localeResources.en!).sort();
  for (const { code } of LOCALES) {
    expect(Object.keys(localeResources[code]!).sort()).toEqual(expected);
    for (const key of expected) {
      const value = localeResources[code]![key]!;
      expect(value.trim().length).toBeGreaterThan(0);
      expect([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()).toEqual([...localeResources.en![key]!.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort());
    }
  }
});
test("preview absence is metadata, never inferred from agent text matching an empty state", () => {
  const history = { paneId: "p", available: true as const, entries: [{ id: "m", uuid: "m", ts: "2026-10-08T00:00:00Z", role: "assistant" as const, parts: [{ kind: "text" as const, text: "No messages yet" }] }], total: 1, fileTruncated: false, hasMore: false };
  expect(latestPersonaPreview(history)).toEqual({ text: "No messages yet" });
});
