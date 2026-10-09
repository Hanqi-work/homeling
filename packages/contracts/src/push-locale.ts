import type { PushPayload } from "./push.ts";
import { LOCALES, resolveLocale, translateCatalog, type LocaleCatalog } from "./locale.ts";

export const pushMessages = {
  "push.approval": ["Needs your approval: {question}", "Benötigt deine Zustimmung: {question}", "Necesita tu aprobación: {question}", "승인이 필요합니다: {question}", "承認が必要です：{question}", "需要你批准：{question}"],
  "push.taskCompleted": ["Task completed: {taskTitle}", "Aufgabe abgeschlossen: {taskTitle}", "Tarea completada: {taskTitle}", "작업 완료: {taskTitle}", "タスク完了：{taskTitle}", "任务完成：{taskTitle}"],
  "push.taskFailed": ["Task failed: {taskTitle}", "Aufgabe fehlgeschlagen: {taskTitle}", "Tarea fallida: {taskTitle}", "작업 실패: {taskTitle}", "タスク失敗：{taskTitle}", "任务失败：{taskTitle}"],
  "push.agentsNeedYou": ["{count} companions need you", "{count} Begleiter brauchen dich", "{count} compañeros te necesitan", "동료 {count}명이 당신을 필요로 합니다", "{count} 人の仲間があなたを必要としています", "{count} 个伙伴需要你"],
  "push.agentNeedsYou": ["{count} companion needs you", "{count} Begleiter braucht dich", "{count} compañero te necesita", "동료 {count}명이 당신을 필요로 합니다", "{count} 人の仲間があなたを必要としています", "{count} 个伙伴需要你"],
  "push.test": ["Notifications connected. Real approvals show the specific question here.", "Benachrichtigungen verbunden. Echte Genehmigungen zeigen hier die konkrete Frage.", "Notificaciones conectadas. Las aprobaciones reales mostrarán aquí la pregunta concreta.", "알림이 연결되었습니다. 실제 승인 요청의 구체적인 질문이 여기에 표시됩니다.", "通知が接続されました。実際の承認リクエストでは具体的な質問をここに表示します。", "通知已连接。真实审批会在这里显示具体问题。"],
} satisfies Record<string, readonly [string, string, string, string, string, string]>;
const entries = Object.entries(pushMessages);
export const pushLocaleResources: LocaleCatalog = Object.fromEntries(LOCALES.map(({ code }, index) => [code, Object.fromEntries(entries.map(([key, values]) => [key, values[index]!]))]));

/** Presentation at the per-subscription send boundary; never an event, identity change or replay. */
export function localizePushPayload(payload: PushPayload, locale: unknown): PushPayload {
  const resolved = resolveLocale(locale);
  function countCopy(count: number): string {
    return translateCatalog(resolved, pushLocaleResources, count === 1 ? "push.agentNeedsYou" : "push.agentsNeedYou", { count });
  }
  const validCount = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count > 0;
  let localized = payload;
  const title = payload.titleTemplate;
  if (title?.key === "push.agentsNeedYou" && validCount(title.params?.count)) localized = { ...localized, title: countCopy(title.params.count) };
  const summary = payload.summaryTemplate;
  if (summary?.key === "push.agentsSummary" && validCount(summary.params?.count) && Array.isArray(summary.questions) && summary.questions.length > 0 && summary.questions.every(item => item && typeof item.personaName === "string" && typeof item.question === "string")) {
    const lines = summary.questions.map(item => `${item.personaName}: ${translateCatalog(resolved, pushLocaleResources, "push.approval", { question: item.question })}`);
    localized = { ...localized, body: [countCopy(summary.params.count), ...lines].join("\n") };
  }
  const template = payload.bodyTemplate;
  if (!template || !Object.hasOwn(pushMessages, template.key)) return localized;
  const params = template.params;
  if (!params || typeof params !== "object") return payload;
  if (template.key === "push.approval" && typeof params.question !== "string") return payload;
  if ((template.key === "push.taskCompleted" || template.key === "push.taskFailed") && typeof params.taskTitle !== "string") return payload;
  let body = translateCatalog(resolved, pushLocaleResources, template.key, { ...params });
  if ((template.key === "push.taskCompleted" || template.key === "push.taskFailed") && typeof params.detail === "string" && params.detail.length > 0) body += `\n${params.detail}`;
  return { ...localized, body };
}
