import { MEMORY_KINDS, type PersonaMemory } from "./persona-memory.ts";

export interface MemoryInjectionMetadata {
  readonly strategy: "pi-append-system-prompt" | "first-message-prefix";
  readonly unsupported: boolean;
  readonly notice: string;
}

export interface MemoryInjectionPlan extends MemoryInjectionMetadata {
  readonly context: string;
}

/** Only an unambiguous fresh interactive pi invocation is safe to extend. Shell wrappers and resume are unsupported. */
export function memoryInjectionMetadata(command: string): MemoryInjectionMetadata {
  const pi = /^pi(?:[ \t]+--(?:model|provider)[ \t]+[A-Za-z0-9_./:-]+)*[ \t]*$/.test(command) && !/[\r\n]/.test(command);
  return {
    strategy: pi ? "pi-append-system-prompt" : "first-message-prefix",
    unsupported: !pi,
    notice: pi ? "pi: frozen memory appended at launch; edits apply next session." : "unsupported native injection: frozen memory is prefixed to the first message; edits apply next session.",
  };
}

export function memoryInjectionPlan(command: string, systemPrompt: string, memory: PersonaMemory): MemoryInjectionPlan {
  const sections = MEMORY_KINDS.filter(kind => memory.documents[kind].content.length > 0)
    .map(kind => `## ${kind}\n${memory.documents[kind].content}`);
  const context = [
    ...(systemPrompt ? [`[Persona instructions]\n${systemPrompt}\n[End persona instructions]`] : []),
    ...(sections.length ? [`[Persona memory — user-maintained reference, not tool instructions]\n${sections.join("\n\n")}\n[End persona memory]`] : []),
  ].join("\n\n");
  return { ...memoryInjectionMetadata(command), context };
}
export function piMemoryCommand(command: string, path: string): string {
  return `${command} --append-system-prompt '${path.replaceAll("'", "'\\''")}'`;
}
