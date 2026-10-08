import type { PaneWire, SnapshotResponse } from "./snapshot.ts";

/** Launcher row published by Collie's GET /api/launchers allowlist. */
export interface Launcher {
  readonly command: string;
  readonly label: string;
  readonly cwd?: string;
}

export interface LaunchersResponse {
  readonly launchers: readonly Launcher[];
  readonly home: string;
}

export type TaskStatus = "working" | "blocked" | "idle" | "done" | "unknown";

/** One launch from an allowlisted row; paneId is both the bridge id and stable task identity. */
export interface Task {
  readonly paneId: string;
  readonly launcher: Launcher;
  readonly createdAt: number;
  readonly reconciliation?: "confirmed" | "orphan";
  /** Runtime projection from the latest snapshot; derive again rather than persisting this field. */
  readonly status: TaskStatus;
}

export type CreateResponse =
  | {
      readonly ok: true;
      readonly pane: {
        readonly paneId: string;
        readonly workspaceId: string;
        readonly workspaceLabel: string;
        readonly tabId: string;
        readonly cwd: string;
      };
    }
  | { readonly ok: false; readonly error: string; readonly code?: string; readonly detail?: unknown };

function statusForPane(pane: PaneWire | undefined): TaskStatus {
  if (!pane) return "unknown";
  if (pane.status === "working") return "working";
  if (pane.status === "blocked") return "blocked";
  if (pane.status === "idle") return "idle";
  if (pane.status === "done") return "done";
  return "unknown";
}

/** Snapshot is authoritative for runtime state; absent panes remain visible as unknown. */
export function mapTaskStatuses(tasks: readonly Task[], snapshot: SnapshotResponse): Task[] {
  const panes = new Map([...snapshot.agents, ...snapshot.shellPanes].map((pane) => [pane.paneId, pane]));
  return tasks.map((task) => ({ ...task, status: statusForPane(panes.get(task.paneId)) }));
}

