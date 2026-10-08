import { memoryInjectionMetadata } from "./memory-injection.ts";
import { MEMORY_KINDS, MemoryError, type MemoryKind, type PersonaMemoryStore } from "./persona-memory.ts";
import type { PersonaRegistry } from "./persona-registry.ts";
import { lockedResponse, SessionLocked, type MutationAdmission } from "./session-lock.ts";

export interface MemoryRuntime { readonly registry: PersonaRegistry; readonly memory: PersonaMemoryStore }
export function isMemoryPath(pathname: string): boolean { return /^\/lite\/api\/persona\/[^/]+\/memory$/.test(pathname); }

async function boundedJson(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new MemoryError("memory.invalid", 400, "JSON body required");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 150_000) { await reader.cancel(); throw new MemoryError("memory.too_large", 413, "Memory request too large"); }
      chunks.push(part.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new MemoryError("memory.invalid", 400, "Invalid UTF-8 JSON body"); }
  } finally { reader.releaseLock(); }
}

/** Caller owns identity/Origin gates; PUT additionally requires an actual session admission. */
export async function handleMemoryRequest(req: Request, runtime: MemoryRuntime, admission?: MutationAdmission): Promise<Response | null> {
  const match = new URL(req.url).pathname.match(/^\/lite\/api\/persona\/([^/]+)\/memory$/);
  if (!match) return null;
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    if (req.method !== "GET" && req.method !== "PUT") return json({ error: "method not allowed" }, 405);
    if (req.method === "PUT") { if (!admission) return lockedResponse(); admission.assert(); }
    let id: string;
    try { id = decodeURIComponent(match[1]!); } catch { throw new MemoryError("memory.invalid", 400, "Invalid persona id"); }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new MemoryError("memory.invalid", 400, "Invalid persona id");
    const persona = await runtime.registry.get(id);
    if (!persona) return json({ error: "persona not found" }, 404);
    let memory;
    if (req.method === "PUT") {
      if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "application/json required" }, 415);
      const value = await boundedJson(req);
      if (!value || typeof value !== "object") throw new MemoryError("memory.invalid", 400, "Invalid memory update");
      const body = value as Record<string, unknown>;
      if (!MEMORY_KINDS.includes(body.kind as MemoryKind) || typeof body.content !== "string" || typeof body.revision !== "string" || !/^[0-9a-f]{64}$/.test(body.revision)) throw new MemoryError("memory.invalid", 400, "kind, content and revision required");
      admission!.assert();
      // Recheck identity after body I/O; do not create storage for a deleted persona.
      if (!await runtime.registry.get(id)) return json({ error: "persona not found" }, 404);
      memory = await runtime.memory.save(id, body.kind as MemoryKind, body.content, body.revision, admission!);
    } else memory = await runtime.memory.read(id);
    const injection = memoryInjectionMetadata(persona.launcherCommand ?? "");
    return json({ ...memory, injection });
  } catch (error) {
    if (error instanceof SessionLocked) return lockedResponse();
    if (error instanceof MemoryError) return json({ error: error.message, code: error.code }, error.status);
    // Filesystem failures are not silently converted to empty memory.
    return json({ error: "Memory storage unavailable; reload before retrying", code: "memory.unavailable" }, 503);
  }
}
