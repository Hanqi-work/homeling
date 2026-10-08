import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActivityEvent, ActivityResponse, TaskOccurrence } from "@homeling/contracts";
import type { MutationAdmission } from "./session-lock.ts";
import type { SystemAdmission } from "./system-admission.ts";
import type { TaskResultAdmission } from "./mutation-result.ts";

interface LedgerState {
  version: 1;
  events: ActivityEvent[];
  occurrences: TaskOccurrence[];
  worked?: string[];
  workEpochs?: Record<string, string>;
  completionEpochs?: Record<string, string>;
}

function validatedLedger(value: unknown): LedgerState {
  const invalid = (): never => { throw new Error("Invalid activity ledger"); };
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const text = (item: unknown): item is string => typeof item === "string" && item.length > 0;
  const date = (item: unknown): boolean => text(item) && Number.isFinite(Date.parse(item));
  if (!object(value) || value.version !== 1 || !Array.isArray(value.events) || !Array.isArray(value.occurrences)) return invalid();
  const occurrences = new Map<string, Record<string, unknown>>();
  for (const item of value.occurrences) {
    if (!object(item) || !text(item.occurrenceKey) || !text(item.personaId) || !text(item.spaceId) || !text(item.paneId) || !text(item.title) || !date(item.createdAt) || !["active", "completed", "failed", "unknown"].includes(String(item.status)) || occurrences.has(item.occurrenceKey)) return invalid();
    occurrences.set(item.occurrenceKey, item);
  }
  const ids = new Set<string>(); const keys = new Set<string>();
  const kinds = new Map<string, Set<string>>();
  let sequence = 0;
  for (const item of value.events) {
    if (!object(item) || !text(item.id) || !text(item.occurrenceKey) || !text(item.kind) || !text(item.dedupeKey) || !date(item.occurredAt) || !["task.created", "task.completed", "task.failed", "task.unknown", "observation.gap"].includes(item.kind) || !["daemon.launch", "herdr.event", "daemon.observer"].includes(String(item.source)) || (item.detail !== undefined && typeof item.detail !== "string") || item.sequence !== sequence + 1 || ids.has(item.id) || keys.has(item.dedupeKey)) return invalid();
    const occurrence = occurrences.get(item.occurrenceKey);
    if (!occurrence || occurrence.paneId !== item.paneId || occurrence.personaId !== item.personaId || item.dedupeKey !== `${item.occurrenceKey}:${item.kind}`) return invalid();
    ids.add(item.id); keys.add(item.dedupeKey); sequence++;
    const found = kinds.get(item.occurrenceKey) ?? new Set<string>(); found.add(item.kind); kinds.set(item.occurrenceKey, found);
  }
  for (const [key, occurrence] of occurrences) {
    const found = kinds.get(key);
    if (!found?.has("task.created")) return invalid();
    const terminal = ["task.completed", "task.failed", "task.unknown"].filter((kind) => found.has(kind));
    if (terminal.length > 1 || (occurrence.status === "active" ? terminal.length !== 0 : terminal[0] !== `task.${occurrence.status}`)) return invalid();
  }
  if (value.worked !== undefined && (!Array.isArray(value.worked) || value.worked.some((key) => typeof key !== "string" || !occurrences.has(key)))) return invalid();
  for (const epochs of [value.workEpochs, value.completionEpochs]) {
    if (epochs !== undefined && (!object(epochs) || Object.entries(epochs).some(([key, epoch]) => !occurrences.has(key) || !text(epoch)))) return invalid();
  }
  return value as unknown as LedgerState;
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
  private observationEpoch = randomUUID();
  constructor(readonly path: string) {}

  private async read(): Promise<LedgerState> {
    try {
      return validatedLedger(JSON.parse(await readFile(this.path, "utf8")));
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

  register(input: { personaId: string; spaceId: string; paneId: string; title: string }, admission: MutationAdmission | TaskResultAdmission): Promise<TaskOccurrence> {
    if ("scope" in admission && (admission.scope !== "task.result" || !("resourceId" in admission) || admission.resourceId !== input.paneId)) return Promise.reject(new Error("Task registration requires user admission or its exact dispatched pane result"));
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
    if (admission.scope !== "activity.observe") return Promise.reject(new Error("activity.observe scope required"));
    const raw = normalizeHerdrActivityEvent(event, data);
    if (!raw) return Promise.resolve();
    return this.commit(admission, (state) => {
      let occurrence = [...state.occurrences].reverse().find((item) => item.paneId === raw.paneId);
      if (!occurrence || occurrence.spaceId !== raw.spaceId) return;
      if (occurrence.status === "completed" && state.completionEpochs?.[occurrence.occurrenceKey] === this.observationEpoch && raw.kind === "status" && raw.status === "working") {
        occurrence = { ...occurrence, occurrenceKey: randomUUID(), createdAt: new Date().toISOString(), status: "active" };
        state.occurrences.push(occurrence);
        this.append(state, occurrence, "task.created", "herdr.event", "New work cycle observed after explicit completion");
      }
      if (occurrence.status !== "active") return;
      if (raw.kind === "status") {
        if (raw.status === "working") {
          state.workEpochs ??= {};
          state.workEpochs[occurrence.occurrenceKey] = this.observationEpoch;
          return;
        }
        if (raw.status !== "done" || state.workEpochs?.[occurrence.occurrenceKey] !== this.observationEpoch) return;
        this.settle(state, occurrence, "completed", "herdr.event");
        state.completionEpochs ??= {};
        state.completionEpochs[occurrence.occurrenceKey] = this.observationEpoch;
      } else this.settle(state, occurrence, "unknown", "herdr.event", "Pane exited/closed; Herdr provides no exit outcome");
    });
  }

  async gap(reason: string, admission: SystemAdmission<"activity.observe">): Promise<void> {
    if (admission.scope !== "activity.observe") throw new Error("activity.observe scope required");
    this.observation = "gap";
    await this.commit(admission, (state) => {
      this.observationEpoch = randomUUID();
      for (const occurrence of state.occurrences.filter((item) => item.status === "active")) {
        this.append(state, occurrence, "observation.gap", "daemon.observer", reason);
        this.settle(state, occurrence, "unknown", "daemon.observer", "Observation gap: completion/failure cannot be recovered from snapshots");
      }
    });
  }

  live(admission: SystemAdmission<"activity.observe">): void {
    if (admission.scope !== "activity.observe") throw new Error("activity.observe scope required");
    admission.assert();
    this.observation = "live";
  }

  fail(occurrenceKey: string, reason: string, admission: MutationAdmission): Promise<void> {
    if ("scope" in admission) return Promise.reject(new Error("Launch failure registration requires the original user admission"));
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
