import type { AgentStatus, PaneWire, SnapshotResponse, TabView, WorkspaceView } from "./snapshot.ts";

/**
 * One row in the M0 conversation list. A pane is not yet a transcript: Collie's snapshot has no
 * message bodies, so the "latest line" is the pane's terminal title (or a status fallback).
 * Stable id is the pane id — required once this feeds assistant-ui ExternalStoreRuntime (M1).
 */
export interface ConversationRow {
  id: string;
  workspaceId: string;
  workspaceLabel: string;
  tabId: string;
  tabLabel: string;
  paneId: string;
  title: string;
  preview: string;
  status: AgentStatus;
  kind: "agent" | "shell";
  agent: string;
}

export interface WorkspaceGroup {
  workspace: WorkspaceView;
  tabs: Array<{
    tab: TabView;
    rows: ConversationRow[];
  }>;
}

function paneTitle(pane: PaneWire): string {
  return pane.paneLabel ?? pane.sessionName ?? pane.terminalTitle ?? pane.agent;
}

function panePreview(pane: PaneWire): string {
  if (pane.terminalTitle && !pane.terminalTitleStale) return pane.terminalTitle;
  if (pane.status === "blocked") return "needs you";
  if (pane.status === "working") return "working";
  return pane.status;
}

export function paneToRow(pane: PaneWire, tabLabel: string): ConversationRow {
  return {
    id: pane.paneId,
    workspaceId: pane.workspaceId,
    workspaceLabel: pane.workspaceLabel,
    tabId: pane.tabId,
    tabLabel,
    paneId: pane.paneId,
    title: paneTitle(pane),
    preview: panePreview(pane),
    status: pane.status,
    kind: pane.kind ?? "agent",
    agent: pane.agent,
  };
}

/**
 * Group every pane (agent + shell) under its workspace and tab, in snapshot order.
 * Tabs with no panes are omitted. Workspaces with no remaining tabs are omitted.
 */
export function snapshotToGroups(snapshot: SnapshotResponse): WorkspaceGroup[] {
  const tabById = new Map(snapshot.tabs.map((tab) => [tab.tabId, tab]));
  const panes = [...snapshot.agents, ...snapshot.shellPanes];
  const groups: WorkspaceGroup[] = [];

  for (const workspace of snapshot.workspaces) {
    const tabs: WorkspaceGroup["tabs"] = [];
    for (const tab of snapshot.tabs) {
      if (tab.workspaceId !== workspace.workspaceId) continue;
      const rows = panes
        .filter((pane) => pane.tabId === tab.tabId && pane.workspaceId === workspace.workspaceId)
        .map((pane) => paneToRow(pane, tab.label));
      if (rows.length > 0) tabs.push({ tab, rows });
    }
    if (tabs.length > 0) groups.push({ workspace, tabs });
  }

  // Panes whose tab is missing from tabs[] still surface, under a synthetic tab, so a partial
  // snapshot cannot hide a live conversation.
  const known = new Set(groups.flatMap((group) => group.tabs.flatMap((entry) => entry.rows.map((row) => row.paneId))));
  const orphans = panes.filter((pane) => !known.has(pane.paneId));
  if (orphans.length > 0) {
    const byWorkspace = new Map<string, PaneWire[]>();
    for (const pane of orphans) {
      const list = byWorkspace.get(pane.workspaceId) ?? [];
      list.push(pane);
      byWorkspace.set(pane.workspaceId, list);
    }
    for (const [workspaceId, list] of byWorkspace) {
      const tabId = list[0]?.tabId ?? "unknown";
      const tab = tabById.get(tabId);
      const entry = {
        tab: tab ?? {
          tabId,
          workspaceId,
          number: 0,
          label: list[0]?.tabLabel ?? tabId,
          focused: false,
          paneCount: list.length,
        },
        rows: list.map((pane) => paneToRow(pane, pane.tabLabel ?? tab?.label ?? tabId)),
      };
      const existing = groups.find((group) => group.workspace.workspaceId === workspaceId);
      if (existing) existing.tabs.push(entry);
      else {
        groups.push({
          workspace: {
            workspaceId,
            number: list[0]?.workspaceNumber ?? 0,
            label: list[0]?.workspaceLabel ?? workspaceId,
            focused: false,
            activeTabId: tabId,
            tabCount: 1,
            paneCount: list.length,
          },
          tabs: [entry],
        });
      }
    }
  }

  return groups;
}
