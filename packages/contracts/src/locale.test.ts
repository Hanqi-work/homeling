import { expect, test } from "bun:test";
import { resolveLocale, translateCatalog } from "./locale.ts";

test("unsupported locale metadata uses English, and catalog gaps use source-language copy", () => {
  expect(resolveLocale("de")).toBe("de");
  expect(resolveLocale(undefined)).toBe("en");
  expect(resolveLocale("fr")).toBe("en");
  const catalog = { en: { "test.message": "Hello {name}" }, de: {} };
  expect(translateCatalog("de", catalog, "test.message", { name: "Mira" })).toBe("Hello Mira");
  expect(translateCatalog("de", catalog, "absent.key")).toBe("absent.key");
  expect(translateCatalog("en", catalog, "test.message", { name: "$& {name}" })).toBe("Hello $& {name}");
});
