import { randomUUID } from "node:crypto";
import type { PersonaMemorySession } from "@homeling/contracts";
import { memoryInjectionPlan, piMemoryCommand } from "./memory-injection.ts";
import type { PersonaMemoryStore } from "./persona-memory.ts";
import type { MutationAdmission } from "./session-lock.ts";

export async function prepareMemorySession(memory: PersonaMemoryStore, id: string, paneId: string, command: string, systemPrompt: string, admission: MutationAdmission): Promise<{ command: string; session: PersonaMemorySession }> {
  admission.assert();
  const plan = memoryInjectionPlan(command, systemPrompt, await memory.read(id));
  admission.assert();
  const session: PersonaMemorySession = { paneId, strategy: plan.strategy, unsupported: plan.unsupported, notice: plan.notice, prefix: plan.strategy === "first-message-prefix" ? plan.context : "" };
  if (plan.strategy !== "pi-append-system-prompt" || !plan.context) return { command, session };
  const path = await memory.freeze(id, plan.context, admission);
  admission.assert();
  return { command: piMemoryCommand(command, path), session };
}

export function memoryMessageText(session: PersonaMemorySession, alreadyInjected: boolean, text: string): string {
  return !alreadyInjected && session.prefix ? `${session.prefix}\n\n${text}` : text;
}

/** Evidence for a future exact transcript-entry binding; never a heuristic prefix-strip rule. */
export function injectedMessagePresentation(personaId: string, paneId: string, displayText: string, confirmationText: string) {
  if (displayText === confirmationText) return undefined;
  return { attemptId: randomUUID(), personaId, paneId, displayText, confirmationText, provenance: "daemon-injection" as const, historyBinding: "required" as const };
}
