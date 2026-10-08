import type { PaneHistoryResponse, SnapshotResponse } from "@homeling/contracts";

const API_PREFIX = `${import.meta.env.BASE_URL}api/`;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

/** Same-origin daemon reverse proxy; the browser never connects to Collie's :8787. */
export function fetchSnapshot(signal?: AbortSignal): Promise<SnapshotResponse> {
  return getJson("snapshot", signal);
}

export function fetchPaneHistory(paneId: string, signal?: AbortSignal, before?: string): Promise<PaneHistoryResponse> {
  const cursor = before ? `?before=${encodeURIComponent(before)}` : "";
  return getJson(`pane/${encodeURIComponent(paneId)}/history${cursor}`, signal);
}
