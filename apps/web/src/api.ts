import type { CreateResponse, Launcher, LaunchersResponse, PaneHistoryResponse, PendingRequest, SnapshotResponse } from "@homeling/contracts";

const API_PREFIX = `${import.meta.env.BASE_URL || "/lite/"}api/`;

/** Raw audio in, editable text out. This endpoint is deliberately pane-agnostic. */
export async function transcribeAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${API_PREFIX}stt`, {
    method: "POST", body: audio,
    headers: { accept: "application/json", "content-type": audio.type || "audio/webm" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  let result: { ok?: boolean; text?: unknown; code?: string } = {};
  try { result = await response.json() as typeof result; } catch {
    throw new Error(`转写失败（${response.status}），请重试。`);
  }
  if (!response.ok || result.ok !== true || typeof result.text !== "string") {
    const message = result.code === "stt.unconfigured" || response.status === 503
      ? "语音转写未配置或不可用，请在电脑上检查 Collie STT 设置。"
      : response.status === 429 ? "转写服务忙，请稍后重试。"
      : response.status === 413 ? "录音过大，请缩短后重试。"
      : response.status === 415 ? "录音格式不受支持，请换浏览器重试。"
      : response.status === 504 ? "转写超时，请重试。"
      : `转写失败（${response.status}），请重试。`;
    throw new Error(message);
  }
  return result.text;
}

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
