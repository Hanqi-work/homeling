import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ts from "typescript";
import { LOCALES, pushLocaleResources } from "@homeling/contracts";
import { localeResources } from "./locale-resources.ts";

const sourceRoot = dirname(import.meta.path);
const technicalText = new Set(["Ctrl+C", "Esc", "Enter", "Cmd", "Homeling", "2-digit", "numeric"]);
const visibleAttributes = new Set(["aria-label", "aria-description", "placeholder", "title", "alt", "disabledReason", "reason"]);
function visibleLiteral(node: ts.Node, file: ts.SourceFile): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isBinaryExpression(parent) || ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) return false;
    if (ts.isCallExpression(parent) && parent.expression.getText(file) === "t" && parent.arguments[0]?.pos <= node.pos && parent.arguments[0]?.end >= node.end) return false;
    if (ts.isJsxAttribute(parent)) return visibleAttributes.has(parent.name.getText(file));
    if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent) || visibleAttributes.has(parent.parent.name.getText(file));
  }
  return false;
}
test("all production TSX in the current authorized integration tree contains no untranslated owned JSX text or accessible copy", async () => {
  const violations: string[] = []; let scanned = 0;
  for await (const name of new Bun.Glob("**/*.tsx").scan(sourceRoot)) {
    if (name.includes(".test.")) continue;
    scanned++;
    const file = ts.createSourceFile(name, await readFile(join(sourceRoot, name), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      const text = ts.isJsxText(node) ? node.text.trim() : (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && visibleLiteral(node, file) ? node.text.trim() : "";
      if (text && /\p{L}/u.test(text) && !technicalText.has(text) && !/^#[0-9a-f]{3,8}$/i.test(text) && !/^\/[\w:%?&=+./-]*$/.test(text) && !Object.hasOwn(localeResources.en!, text)) violations.push(`${name}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${text}`);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  expect(scanned).toBeGreaterThanOrEqual(22);
  expect(violations).toEqual([]);
});
test("all literal translation references, copy keys and wire-domain dynamic keys resolve in every locale", async () => {
  const references = new Set<string>();
  for (const extension of ["ts", "tsx"]) for await (const name of new Bun.Glob(`**/*.${extension}`).scan(sourceRoot)) {
    if (/\.test\.|locale.*resources/.test(name)) continue;
    const file = ts.createSourceFile(name, await readFile(join(sourceRoot, name), "utf8"), ts.ScriptTarget.Latest, true, extension === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === "t") { const key = node.arguments[0]; if (key && ts.isStringLiteral(key)) references.add(key.text); }
      if (ts.isStringLiteral(node) && /^(?:common|locale|message|delivery|permission|mirror|task|composer|voice|nav|persona|personaDetail|page|specialKey|memory|session|app|activity|avatar|triage|push)\.[a-zA-Z]+$/.test(node.text)) references.add(node.text);
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === "key" && ts.isStringLiteral(node.initializer) && /^[a-z]+\.[a-zA-Z]+$/.test(node.initializer.text)) references.add(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  for (const key of ["task.working", "task.blocked", "task.idle", "task.done", "task.starting", "persona.thinking", "persona.active", "persona.idle", "persona.blocked", "personaDetail.memory", "personaDetail.activity", "personaDetail.customize"]) references.add(key);
  const missing: string[] = [];
  for (const { code } of LOCALES) for (const key of references) if (!localeResources[code]?.[key]?.trim()) missing.push(`${code}:${key}`);
  for (const { code } of LOCALES) for (const key of ["push.approval", "push.taskCompleted", "push.taskFailed", "push.test"]) if (!pushLocaleResources[code]?.[key]?.trim()) missing.push(`native:${code}:${key}`);
  expect(missing).toEqual([]);
});
