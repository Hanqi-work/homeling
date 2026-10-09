import type { PaneHistoryResponse, PersonaView } from "@homeling/contracts";
import { translate, type Translate } from "./locale.tsx";

export interface PersonaPreview { text: string; fallbackKey?: string }
export function latestPersonaPreview(history: PaneHistoryResponse): PersonaPreview {
  if (!history.available) return { text: "", fallbackKey: "persona.historyUnavailable" };
  for (const entry of [...history.entries].reverse()) {
    if (entry.abandoned || (entry.role !== "user" && entry.role !== "assistant")) continue;
    const text = entry.parts.filter((part) => part.kind === "text").map((part) => part.text).join(" ").trim();
    if (text) return { text: text.replace(/\s+/g, " ") };
  }
  return { text: "", fallbackKey: "persona.noMessages" };
}
export function latestPersonaLine(history: PaneHistoryResponse): string {
  const preview = latestPersonaPreview(history);
  return preview.fallbackKey ? translate("en", preview.fallbackKey) : preview.text;
}
export function personaStatusLabel(persona: PersonaView, stale = false, t: Translate = (key) => translate("en", key)): string {
  if (stale) return t("persona.statusUnavailable");
  if (persona.needsAttention) return t("persona.needsAttention");
  if (persona.paused) return t("persona.paused");
  if (persona.statusSource === "missing") return t("persona.mainUnavailable");
  if (persona.statusSource === "pane") return t("persona.agentStatusUnavailable");
  return t(`persona.${persona.status}`);
}
