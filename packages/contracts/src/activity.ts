export type ActivityKind = "task.created" | "task.completed" | "task.failed" | "task.unknown" | "observation.gap";

/** Stable pane navigation identity, with a distinct persisted identity for each task run. */
export interface TaskOccurrence {
  readonly occurrenceKey: string;
  readonly personaId: string;
  readonly spaceId: string;
  readonly paneId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly status: "active" | "completed" | "failed" | "unknown";
}

export interface ActivityEvent {
  readonly id: string;
  readonly sequence: number;
  readonly dedupeKey: string;
  readonly kind: ActivityKind;
  readonly personaId: string;
  readonly paneId: string;
  readonly occurrenceKey: string;
  /** Observation/commit time; never an invented upstream execution timestamp. */
  readonly occurredAt: string;
  readonly source: "daemon.launch" | "herdr.event" | "daemon.observer";
  readonly detail?: string;
}

export interface ActivityResponse {
  readonly events: readonly ActivityEvent[];
  readonly occurrences: readonly TaskOccurrence[];
  readonly observation: "live" | "gap" | "starting";
}
