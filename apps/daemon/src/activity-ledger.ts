import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActivityEvent, ActivityResponse, TaskOccurrence } from "@homeling/contracts";
import type { MutationAdmission } from "./session-lock.ts";
import type { SystemAdmission } from "./system-admission.ts";

interface LedgerState {
  version: 1;
  events: ActivityEvent[];
  occurrences: TaskOccurrence[];
  worked?: string[];
}

type ObservedEvent = { kind: "status"; paneId: string; spaceId: string; status: "idle" | "working" | "blocked" | "done" | "unknown" } | { kind: "exit"; paneId: string; spaceId: string };

/** Only fields actually supported by the Herdr wire contract are consumed. */
export function normalizeHerdrActivityEvent(event: string, data: unknown): ObservedEvent | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const body = data as Record<string, unknown>;
  if (typeof body.pane_id !== "string" || !/^[A-Za-z0-9:._~-]{1,256}$/.test(body.pane_id) || typeof body.workspace_id !== "string" || !/^[A-Za-z0-9:._~-]{1,256}$/.test(body.workspace_id)) return null;
  const name = event.replaceAll(".", "_");
  if (body.type !== undefined && body.type !== name && body.type !== event) return null;
  if (name === "pane_exited" || name === "pane_closed") return { kind: "exit", paneId: body.pane_id, spaceId: body.workspace_id };
  if (name !== "pane_agent_status_changed" || !["idle", "working", "blocked", "done", "unknown"].includes(String(body.agent_status))) return null;
  return { kind: "status", paneId: body.pane_id, spaceId: body.workspace_id, status: body.agent_status as Extract<ObservedEvent, { kind: "status" }>["status"] };
}

export class ActivityLedger {
  private tail: Promise<void> = Promise.resolve();
  private listeners = new Set<(event: ActivityEvent) => void>();
  private observation: ActivityResponse["observation"] = "starting";
  constructor(readonly path: string) {}

  private async read(): Promise<LedgerState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as LedgerState;
      if (state.version !== 1 || !Array.isArray(state.events) || !Array.isArray(state.occurrences)) throw new Error("Invalid activity ledger");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, events: [], occurrences: [] };
    }
  }

  private commit<T>(admission: MutationAdmission, change: (state: LedgerState) => T): Promise<T> {
    const result = this.tail.then(async () => {
      admission.assert();
      const state = await this.read();
      const previous = state.events.length;
      const value = change(state);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
        await admission.dispatch(() => rename(temporary, this.path));
      } finally { await rm(temporary, { force: true }); }
      for (const event of state.events.slice(previous)) for (const listener of this.listeners) {
        try { listener(structuredClone(event)); }
        catch (error) { console.error("[homeling-daemon] activity subscriber failed", error); }
      }
      return structuredClone(value);
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  subscribe(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async list(personaId?: string, afterSequence = 0): Promise<ActivityResponse> {
    await this.tail;
    const state = await this.read();
    return {
      events: state.events.filter((event) => (!personaId || event.personaId === personaId) && event.sequence > afterSequence),
      occurrences: state.occurrences.filter((occurrence) => !personaId || occurrence.personaId === personaId),
      observation: this.observation,
    };
  }

  async ownership(paneId: string): Promise<TaskOccurrence | undefined> {
    const { occurrences } = await this.list();
    return [...occurrences].reverse().find((occurrence) => occurrence.paneId === paneId);
  }

  register(input: { personaId: string; spaceId: string; paneId: string; title: string }, admission: MutationAdmission): Promise<TaskOccurrence> {
    return this.commit(admission, (state) => {
      const current = [...state.occurrences].reverse().find((item) => item.paneId === input.paneId);
      if (current && (current.personaId !== input.personaId || current.spaceId !== input.spaceId)) throw new Error("Task ownership cannot be reassigned");
      if (current?.status === "active") return current;
      const occurrence: TaskOccurrence = { ...input, occurrenceKey: randomUUID(), createdAt: new Date().toISOString(), status: "active" };
      state.occurrences.push(occurrence);
      this.append(state, occurrence, "task.created", "daemon.launch");
      return occurrence;
    });
  }

  observe(event: string, data: unknown, admission: SystemAdmission<"activity.observe">): Promise<void> {
    const raw = normalizeHerdrActivityEvent(event, data);
    if (!raw) return Promise.resolve();
    return this.commit(admission, (state) => {
      let occurrence = [...state.occurrences].reverse().find((item) => item.paneId === raw.paneId);
      if (!occurrence || occurrence.spaceId !== raw.spaceId) return;
      if (occurrence.status === "completed" && raw.kind === "status" && raw.status === "working") {
        occurrence = { ...occurrence, occurrenceKey: randomUUID(), createdAt: new Date().toISOString(), status: "active" };
        state.occurrences.push(occurrence);
        this.append(state, occurrence, "task.created", "herdr.event", "New work cycle observed after explicit completion");
      }
      if (occurrence.status !== "active") return;
      if (raw.kind === "status") {
        if (raw.status === "working") {
          if (!state.events.some((item) => item.occurrenceKey === occurrence.occurrenceKey && item.kind === "task.completed")) {
            state.worked ??= [];
            if (!state.worked.includes(occurrence.occurrenceKey)) state.worked.push(occurrence.occurrenceKey);
          }
          return;
        }
        if (raw.status !== "done" || !state.worked?.includes(occurrence.occurrenceKey)) return;
        this.settle(state, occurrence, "completed", "herdr.event");
      } else this.settle(state, occurrence, "unknown", "herdr.event", "Pane exited/closed; Herdr provides no exit outcome");
    });
  }

  async gap(reason: string, admission: SystemAdmission<"activity.observe">): Promise<void> {
    this.observation = "gap";
    await this.commit(admission, (state) => {
      for (const occurrence of state.occurrences.filter((item) => item.status === "active")) {
        this.append(state, occurrence, "observation.gap", "daemon.observer", reason);
        this.settle(state, occurrence, "unknown", "daemon.observer", "Observation gap: completion/failure cannot be recovered from snapshots");
      }
    });
  }

  live(admission: SystemAdmission<"activity.observe">): void {
    admission.assert();
    this.observation = "live";
  }

  fail(occurrenceKey: string, reason: string, admission: MutationAdmission): Promise<void> {
    return this.commit(admission, (state) => {
      const occurrence = state.occurrences.find((item) => item.occurrenceKey === occurrenceKey);
      if (occurrence) this.settle(state, occurrence, "failed", "daemon.launch", reason);
    });
  }

  private settle(state: LedgerState, occurrence: TaskOccurrence, status: "completed" | "failed" | "unknown", source: ActivityEvent["source"], detail?: string): void {
    if (occurrence.status !== "active") return;
    state.occurrences[state.occurrences.indexOf(occurrence)] = { ...occurrence, status };
    this.append(state, occurrence, `task.${status}`, source, detail);
  }

  private append(state: LedgerState, occurrence: TaskOccurrence, kind: ActivityEvent["kind"], source: ActivityEvent["source"], detail?: string): void {
    const dedupeKey = `${occurrence.occurrenceKey}:${kind}`;
    if (state.events.some((event) => event.dedupeKey === dedupeKey)) return;
    state.events.push({ id: randomUUID(), sequence: (state.events.at(-1)?.sequence ?? 0) + 1, dedupeKey, kind, source, personaId: occurrence.personaId, paneId: occurrence.paneId, occurrenceKey: occurrence.occurrenceKey, occurredAt: new Date().toISOString(), ...(detail ? { detail } : {}) });
  }
}
