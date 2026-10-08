import type { PaneHistoryResponse, PersonaView } from "@homeling/contracts";

export function latestPersonaLine(history: PaneHistoryResponse): string {
  if (!history.available) return "Conversation history unavailable";
  for (const entry of [...history.entries].reverse()) {
    if (entry.abandoned || (entry.role !== "user" && entry.role !== "assistant")) continue;
    const text = entry.parts.filter((part) => part.kind === "text").map((part) => part.text).join(" ").trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return "No messages yet";
}

export function personaStatusLabel(persona: PersonaView, stale = false): string {
  if (stale) return "Status unavailable · last known data";
  if (persona.needsAttention) return "Needs attention";
  if (persona.paused) return "Paused";
  if (persona.statusSource === "missing") return "Main pane unavailable";
  if (persona.statusSource === "pane") return "Active · agent status unavailable";
  return { thinking: "Thinking", active: "Active", idle: "Idle", blocked: "Blocked · needs you" }[persona.status];
}
