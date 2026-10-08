import type { CreateResponse, Launcher, LaunchersResponse, PaneHistoryResponse, PendingRequest, PersonaListResponse, PersonaView, SnapshotResponse } from "@homeling/contracts";

import { sessionState } from "./session-state.ts";

/** UI admission complements, never replaces, the daemon cookie/epoch gate. */
export async function sessionMutationFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try { sessionState.admit()(); } catch { throw new ReplyRequestError("Unlock Homeling and confirm this action", false); }
  const response = await fetch(input, init);
  if (response.status === 423) sessionState.lock();
  return response;
}

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

export function fetchPersonas(signal?: AbortSignal): Promise<PersonaListResponse> {
  return getJson("persona/list", signal);
}

export async function createPersona(input: { name: string; avatar: { color: string }; systemPrompt?: string }): Promise<PersonaView> {
  const response = await sessionMutationFetch(`${API_PREFIX}persona`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as { persona?: PersonaView; error?: string } | null;
  if (!response.ok || !result?.persona) throw new Error(result?.error ?? `Create persona failed (${response.status})`);
  return result.persona;
}

export async function sendPersonaMessage(personaId: string, text: string): Promise<string | undefined> {
  const response = await sessionMutationFetch(`${API_PREFIX}persona/${encodeURIComponent(personaId)}/message`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  let result: { ok?: boolean; error?: string; textDelivered?: boolean | null; deliveryUnknown?: boolean; personaConfirmationText?: string } = {};
  try { result = await response.json() as typeof result; } catch { /* use HTTP fallback */ }
  if (!response.ok || result.ok !== true) {
    throw new ReplyRequestError(
      result.error ?? `message ${response.status}`,
      result.textDelivered === true ? true : result.deliveryUnknown === true ? null : typeof result.textDelivered === "boolean" ? result.textDelivered : response.status < 500 ? false : null,
      result.personaConfirmationText,
    );
  }
  return result.personaConfirmationText;
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
export async function launchTask(launcher: Launcher, paneId?: string, personaId?: string): Promise<Extract<CreateResponse, { ok: true }>> {
  const body = personaId !== undefined
    ? { command: launcher.command, personaId }
    : paneId === undefined
      ? { command: launcher.command }
      : { command: launcher.command, paneId };
  const response = await sessionMutationFetch(`${API_PREFIX}launch`, {
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
  const response = await sessionMutationFetch(`${API_PREFIX}requests/${encodeURIComponent(requestId)}/approve`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
  let result: (ApprovalResponse & { deliveryUnknown?: boolean }) | null = null;
  try {
    result = await response.json() as ApprovalResponse;
  } catch {
    // The status below still distinguishes a stale request from a failed network write.
  }
  if (response.status === 423) return result?.deliveryUnknown === true
    ? { status: "resolved", outcome: "unknown" }
    : { status: "pending", outcome: "not-submitted" };
  if (result && ["pending", "resolved", "expired"].includes(result.status)) return result;
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
  const response = await sessionMutationFetch(`${API_PREFIX}pane/${encodeURIComponent(paneId)}/stop`, {
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
  constructor(
    message: string,
    readonly textDelivered: boolean | null = null,
    readonly confirmationText?: string,
  ) {
    super(message);
    this.name = "ReplyRequestError";
  }
}

/** Submit text to an existing Collie pane; history polling, not this response, confirms delivery. */
export async function sendPaneReply(paneId: string, text: string): Promise<void> {
  const response = await sessionMutationFetch(`${API_PREFIX}pane/${encodeURIComponent(paneId)}/reply`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ text, submit: true }),
  });
  let result: { ok?: boolean; error?: string; textDelivered?: boolean | null; deliveryUnknown?: boolean } = {};
  try {
    result = await response.json() as typeof result;
  } catch {
    // A non-JSON error still carries its HTTP status below.
  }
  if (!response.ok || result.ok !== true) {
    throw new ReplyRequestError(
      result.error ?? `reply ${response.status}`,
      result.textDelivered === true ? true : result.deliveryUnknown === true ? null : typeof result.textDelivered === "boolean" ? result.textDelivered : response.status < 500 ? false : null,
    );
  }
}
