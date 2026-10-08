export type MemoryKind = "facts" | "preferences" | "project";
export type MemoryFetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface MemoryDocument { content: string; revision: string }
export interface PersonaMemory {
  documents: Record<MemoryKind, MemoryDocument>;
  effective: "next-session";
  injection: { strategy: string; unsupported: boolean; notice: string };
}

function parseMemory(value: unknown): PersonaMemory {
  if (!value || typeof value !== "object") throw new Error("Invalid memory response");
  const memory = value as PersonaMemory;
  for (const kind of ["facts", "preferences", "project"] as const) {
    const document = memory.documents?.[kind];
    if (!document || typeof document.content !== "string" || typeof document.revision !== "string") throw new Error("Invalid memory document");
  }
  const injection = memory.injection;
  if (memory.effective !== "next-session" || !injection || typeof injection.strategy !== "string"
    || typeof injection.unsupported !== "boolean" || typeof injection.notice !== "string") throw new Error("Invalid memory injection metadata");
  return memory;
}

export class MemoryRequestError extends Error {
  constructor(public readonly status: number) { super(`Memory request failed (${status})`); }
}

export async function getPersonaMemory(personaId: string, fetcher: MemoryFetcher = fetch): Promise<PersonaMemory> {
  const response = await fetcher(`/lite/api/persona/${encodeURIComponent(personaId)}/memory`, { method: "GET", cache: "no-store" });
  if (!response.ok) throw new MemoryRequestError(response.status);
  return parseMemory(await response.json());
}

export async function putPersonaMemory(personaId: string, document: { kind: MemoryKind; content: string; revision: string }, fetcher: MemoryFetcher = fetch): Promise<PersonaMemory> {
  const response = await fetcher(`/lite/api/persona/${encodeURIComponent(personaId)}/memory`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document),
  });
  if (!response.ok) throw new MemoryRequestError(response.status);
  return parseMemory(await response.json());
}
