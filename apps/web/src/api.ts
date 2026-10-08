import type { CreateResponse, Launcher, LaunchersResponse, PaneHistoryResponse, PendingRequest, SnapshotResponse } from "@homeling/contracts";

const API_PREFIX = `${import.meta.env.BASE_URL || "/lite/"}api/`;

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

export function fetchLaunchers(signal?: AbortSignal): Promise<LaunchersResponse> {
  return getJson("launchers", signal);
}

export class LaunchRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "LaunchRequestError";
  }
}

/** The daemon re-proxies Collie's launch endpoint; a task exists only after its pane id is returned. */
export async function launchTask(launcher: Launcher, paneId?: string): Promise<Extract<CreateResponse, { ok: true }>> {
  const body = paneId === undefined
    ? { command: launcher.command }
    : { command: launcher.command, paneId };
  const response = await fetch(`${API_PREFIX}launch`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let result: CreateResponse | null = null;
  try {
    result = await response.json() as CreateResponse;
  } catch {
    // Preserve a useful HTTP-level error when the bridge is unavailable or returned plain text.
  }
  if (!response.ok || result?.ok !== true || !result.pane?.paneId) {
    const failure = result && !result.ok ? result : null;
    throw new LaunchRequestError(failure?.error ?? `Launch failed (${response.status})`, failure?.code);
  }
  return result;
}

export function fetchPendingRequests(signal?: AbortSignal): Promise<PendingRequest[]> {
  return getJson("requests", signal);
}

export interface ApprovalResponse {
  readonly status: "pending" | "resolved" | "expired";
  readonly outcome: "submitted" | "unknown" | "already-handled" | "stale" | "not-submitted";
}

export async function approvePendingRequest(requestId: string, optionId: string): Promise<ApprovalResponse> {
  const response = await fetch(`${API_PREFIX}requests/${encodeURIComponent(requestId)}/approve`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
  let result: ApprovalResponse | null = null;
  try {
    result = await response.json() as ApprovalResponse;
  } catch {
    // The status below still distinguishes a stale request from a failed network write.
  }
  if (result) return result;
  throw new Error(`approval ${response.status}`);
}

export function fetchPaneHistory(paneId: string, signal?: AbortSignal, before?: string): Promise<PaneHistoryResponse> {
  const cursor = before ? `?before=${encodeURIComponent(before)}` : "";
  return getJson(`pane/${encodeURIComponent(paneId)}/history${cursor}`, signal);
}

export interface PaneReadResponse {
  readonly paneId: string;
  readonly text: string;
  readonly truncated?: boolean;
  readonly revision?: number;
}

/** Read the bounded current pane screen; this is not a terminal control channel. */
export function fetchPaneScreen(paneId: string, signal?: AbortSignal): Promise<PaneReadResponse> {
  return getJson(`pane/${encodeURIComponent(paneId)}`, signal);
}

export async function stopPaneTask(paneId: string): Promise<void> {
  const response = await fetch(`${API_PREFIX}pane/${encodeURIComponent(paneId)}/stop`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
  });
  let result: { ok?: boolean; error?: string } = {};
  try {
    result = await response.json() as typeof result;
  } catch {
    // Preserve an HTTP-level error when the bridge is unavailable.
  }
  if (!response.ok || result.ok !== true) throw new Error(result.error ?? `stop ${response.status}`);
}

export type ControlKeyAction = "interrupt" | "escape";
export interface ControlKeyResult {
  outcome: "accepted" | "not-submitted" | "unknown";
  error?: string;
}

/** One write only. Acknowledgement is not TUI consumption; unknown must never be retried automatically. */
export async function sendPaneControlKey(paneId: string, action: ControlKeyAction, identity: string): Promise<ControlKeyResult> {
  try {
    const response = await fetch(`${API_PREFIX}pane/${encodeURIComponent(paneId)}/control-key`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action, identity, confirmed: true }), signal: AbortSignal.timeout(15000),
    });
    let value: unknown;
    try { value = await response.json(); } catch { /* HTTP rejection below is still definite. */ }
    if (value && typeof value === "object" && "outcome" in value) {
      const result = value as ControlKeyResult;
      if ((response.ok && result.outcome === "accepted") || result.outcome === "not-submitted" || result.outcome === "unknown") {
        return { outcome: result.outcome, error: typeof result.error === "string" ? result.error : undefined };
      }
    }
    return { outcome: [400, 401, 403, 404, 405, 415, 429].includes(response.status) ? "not-submitted" : "unknown", error: `control key ${response.status}` };
  } catch {
    return { outcome: "unknown", error: "Network lost or timed out; do not repeat the key" };
  }
}

export class ReplyRequestError extends Error {
  constructor(message: string, readonly textDelivered: boolean | null = null) {
    super(message);
    this.name = "ReplyRequestError";
  }
}

/** Submit text to an existing Collie pane; history polling, not this response, confirms delivery. */
export async function sendPaneReply(paneId: string, text: string): Promise<void> {
  const response = await fetch(`${API_PREFIX}pane/${encodeURIComponent(paneId)}/reply`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ text, submit: true }),
  });
  let result: { ok?: boolean; error?: string; textDelivered?: boolean } = {};
  try {
    result = await response.json() as typeof result;
  } catch {
    // A non-JSON error still carries its HTTP status below.
  }
  if (!response.ok || result.ok !== true) {
    throw new ReplyRequestError(
      result.error ?? `reply ${response.status}`,
      typeof result.textDelivered === "boolean" ? result.textDelivered : response.status < 500 ? false : null,
    );
  }
}
