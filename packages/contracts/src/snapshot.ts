/**
 * Wire shapes of Collie `GET /api/snapshot` that Homeling's message mapping needs.
 *
 * Subset of `bridge/types.ts` (`SnapshotResponse`, `PaneWire`, `WorkspaceView`, `TabView`) on
 * Collie v1.14.2. Extra fields the bridge may add are tolerated by structural typing; this file
 * only names what the mapper reads. Solo snapshots omit `host` / `session`.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type BridgeStatus = "connected" | "disconnected";

/** Agent-bearing or bare-shell pane as the browser sees it. */
export interface PaneWire {
  paneId: string;
  workspaceId: string;
  workspaceLabel: string;
  workspaceNumber: number;
  tabId: string;
  agent: string;
  status: AgentStatus;
  cwd: string;
  focused: boolean;
  kind?: "agent" | "shell";
  paneLabel?: string;
  sessionName?: string;
  tabLabel?: string;
  terminalTitle?: string;
  terminalTitleStale?: boolean;
  lastActiveAt?: number;
  lastSeenAt?: number;
  host?: string;
  session?: string;
}

export interface WorkspaceView {
  workspaceId: string;
  number: number;
  label: string;
  focused: boolean;
  activeTabId: string;
  tabCount: number;
  paneCount: number;
  host?: string;
}

export interface TabView {
  tabId: string;
  workspaceId: string;
  number: number;
  label: string;
  focused: boolean;
  paneCount: number;
  host?: string;
}

export interface SessionSummary {
  name: string;
  isPrimary: boolean;
  reachable: boolean;
  agents: number;
  working: number;
  blocked: number;
  host?: string;
}

/** GET /api/snapshot. Unknown additive keys are ignored by consumers. */
export interface SnapshotResponse {
  bridge: BridgeStatus;
  agents: PaneWire[];
  shellPanes: PaneWire[];
  workspaces: WorkspaceView[];
  tabs: TabView[];
  sessions: SessionSummary[];
  ts: number;
}
