import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ts from "typescript";
import { LOCALES } from "@homeling/contracts";
import { localeResources } from "./locale-resources.ts";

const sourceRoot = dirname(import.meta.path);
// Delivered migrated surfaces only for this phase. Expand to every production TSX after all final tips.
const migratedSurfaces = ["App.tsx", "PersonaDetail.tsx", "ConversationMessage.tsx", "PendingRequestCard.tsx", "RawPaneMirror.tsx", "TaskChip.tsx", "ReplyComposer.tsx", "SpecialKeyBar.tsx", "locale.tsx"];
const technicalText = new Set(["Ctrl+C", "Esc", "Enter", "Cmd", "→", "·", ":"]);
test("migrated surfaces contain no untranslated product JSX text or accessible names", async () => {
  const violations: string[] = [];
  for (const name of migratedSurfaces) {
    const file = ts.createSourceFile(name, await readFile(join(sourceRoot, name), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      const text = ts.isJsxText(node) ? node.text.trim() : ts.isJsxAttribute(node) && ["aria-label", "placeholder", "title", "alt"].includes(node.name.getText(file)) && node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer.text.trim() : "";
      if (text && !technicalText.has(text)) violations.push(`${name}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${text}`);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  expect(violations).toEqual([]);
});
test("every literal translation reference and structured copy key has a nonempty entry in every locale", async () => {
  const references = new Set<string>();
  for (const extension of ["ts", "tsx"]) for await (const name of new Bun.Glob(`**/*.${extension}`).scan(sourceRoot)) {
    if (/\.test\.|locale.*resources/.test(name)) continue;
    const file = ts.createSourceFile(name, await readFile(join(sourceRoot, name), "utf8"), ts.ScriptTarget.Latest, true, extension === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === "t") {
        const key = node.arguments[0]; if (key && ts.isStringLiteral(key)) references.add(key.text);
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === "key" && ts.isStringLiteral(node.initializer) && /^[a-z]+\.[a-zA-Z]+$/.test(node.initializer.text)) references.add(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  for (const key of ["task.working", "task.blocked", "task.idle", "task.done", "task.starting", "persona.thinking", "persona.active", "persona.idle", "persona.blocked", "personaDetail.memory", "personaDetail.activity", "personaDetail.customize"]) references.add(key);
  const missing: string[] = [];
  for (const { code } of LOCALES) for (const key of references) if (!localeResources[code]?.[key]?.trim()) missing.push(`${code}:${key}`);
  expect(missing).toEqual([]);
});
