import { expect, test } from "bun:test";
import { LOCALES } from "./locale.ts";
import type { PushPayload } from "./push.ts";
import { localizePushPayload } from "./push-locale.ts";

const question = "mkfifo fixture-fifo $& {question} 原文";
const payload: PushPayload = { version: 1, type: "notification", title: "Mira 原名", body: "legacy body", bodyTemplate: { key: "push.approval", params: { question } }, tag: "same-tag", url: "/lite/persona/mira", occurrenceKey: "same-occurrence" };
test("native notification templates localize for all six locales without translating original question, title or occurrence identity", () => {
  for (const { code } of LOCALES) {
    const result = localizePushPayload(payload, code);
    expect(result.body).toContain(question);
    expect(result.title).toBe("Mira 原名");
    expect(result.occurrenceKey).toBe("same-occurrence");
    expect(result.tag).toBe("same-tag");
    expect(result.url).toBe("/lite/persona/mira");
    expect(result.bodyTemplate?.params.question).toBe(question);
  }
  expect(localizePushPayload(payload, "de").body).toBe(`Benötigt deine Zustimmung: ${question}`);
  expect(localizePushPayload(payload, "ja").body).toBe(`承認が必要です：${question}`);
});
test("grouped native notifications translate the persona count and every system prefix without changing raw questions or occurrence", () => {
  const grouped: PushPayload = { ...payload, bodyTemplate: undefined, title: "2 个伙伴需要你", body: "legacy grouped body", titleTemplate: { key: "push.agentsNeedYou", params: { count: 2 } }, summaryTemplate: { key: "push.agentsSummary", params: { count: 2 }, questions: [{ personaName: "Mira 原名", question }, { personaName: "Mira 原名", question: "Second 原文" }, { personaName: "Bob $&", question: "Third {count}" }] } };
  expect(localizePushPayload(grouped, "en")).toMatchObject({ title: "2 companions need you", body: `2 companions need you\nMira 原名: Needs your approval: ${question}\nMira 原名: Needs your approval: Second 原文\nBob $&: Needs your approval: Third {count}`, tag: "same-tag", occurrenceKey: "same-occurrence", url: "/lite/persona/mira" });
  for (const { code } of LOCALES) {
    const result = localizePushPayload(grouped, code);
    expect(result.title).toContain("2");
    expect(result.body).toContain(question);
    expect(result.body).toContain("Bob $&");
    expect(result.body).toContain("Third {count}");
    expect(result.summaryTemplate).toBe(grouped.summaryTemplate);
  }
  const single = { ...grouped, titleTemplate: { key: "push.agentsNeedYou" as const, params: { count: 1 } }, summaryTemplate: { ...grouped.summaryTemplate!, params: { count: 1 } } };
  expect(localizePushPayload(single, "en").title).toBe("1 companion needs you");
  expect(localizePushPayload(single, "de").title).toBe("1 Begleiter braucht dich");
  expect(localizePushPayload(grouped, "ja").title).toBe("2 人の仲間があなたを必要としています");
});
test("missing or invalid locale defaults to English; legacy payloads without metadata are not guessed from their text", () => {
  expect(localizePushPayload(payload, undefined).body).toBe(`Needs your approval: ${question}`);
  expect(localizePushPayload(payload, "unsupported").body).toBe(`Needs your approval: ${question}`);
  const legacy = { ...payload, bodyTemplate: undefined };
  expect(localizePushPayload(legacy, "zh").body).toBe("legacy body");
});
test("task completion and failure system prefixes translate while title and details remain literal", () => {
  const params = { taskTitle: "Original title $&", detail: "Original failure\n原文 {taskTitle}" };
  for (const key of ["push.taskCompleted", "push.taskFailed"] as const) {
    const result = localizePushPayload({ ...payload, bodyTemplate: { key, params } }, "es");
    expect(result.body).toContain(params.taskTitle);
    expect(result.body).toContain(params.detail);
  }
  expect(localizePushPayload({ ...payload, bodyTemplate: { key: "push.test", params: {} } }, "ko").body).toContain("알림이 연결되었습니다");
});
