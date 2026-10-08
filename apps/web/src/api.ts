import type { CreateResponse, Launcher, LaunchersResponse, PaneHistoryResponse, PendingRequest, PersonaAvatar, PersonaRecord, PersonaListResponse, PersonaView, SnapshotResponse } from "@homeling/contracts";

import { sessionState } from "./session-state.ts";

/** UI admission complements, never replaces, the daemon cookie/epoch gate. */
export async function sessionMutationFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try { sessionState.admit()(); } catch { throw new ReplyRequestError("Unlock Homeling and confirm this action", false); }
  const response = await fetch(input, init);
  if (response.status === 423) sessionState.lock();
  return response;
}

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

export interface PersonaAppearancePatch {
  readonly name: string;
  readonly avatar: PersonaAvatar;
}

export class PersonaAppearanceError extends Error {
  constructor(message: string, readonly notDispatched = false) {
    super(message);
    this.name = "PersonaAppearanceError";
  }
}

export async function updatePersonaAppearance(personaId: string, patch: PersonaAppearancePatch): Promise<PersonaRecord> {
  let response: Response;
  try {
    response = await sessionMutationFetch(`${API_PREFIX}persona/${encodeURIComponent(personaId)}`, {
      method: "PATCH", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ name: patch.name, avatar: patch.avatar }),
    });
  } catch (error) {
    if (error instanceof ReplyRequestError && error.textDelivered === false) throw new PersonaAppearanceError(error.message, true);
    throw new PersonaAppearanceError("Save outcome unknown. Check saved customization before retrying.");
  }
  const result = await response.json().catch(() => null) as { persona?: PersonaRecord; error?: string } | null;
  if (!response.ok || result?.persona?.id !== personaId) {
    throw new PersonaAppearanceError(result?.error ?? `Save could not be confirmed (${response.status}). Check saved customization.`, response.status === 423 || [400, 401, 403, 404, 415].includes(response.status));
  }
  return result.persona;
}

export interface PersonaDeleteResult {
  readonly deleted: boolean;
  readonly archived: boolean;
}

export class PersonaDeleteError extends Error {
  constructor(message: string, readonly notDispatched = false) {
    super(message);
    this.name = "PersonaDeleteError";
  }
}

export async function deletePersona(personaId: string): Promise<PersonaDeleteResult> {
  const response = await fetch(`${API_PREFIX}persona/${encodeURIComponent(personaId)}`, {
    method: "DELETE", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}",
  });
  const result = await response.json().catch(() => null) as (Partial<PersonaDeleteResult> & { error?: string }) | null;
  if (!response.ok || typeof result?.deleted !== "boolean" || typeof result.archived !== "boolean") {
    throw new PersonaDeleteError(result?.error ?? `Deletion could not be confirmed (${response.status}); check the persona before retrying.`, response.status === 423);
  }
  return { deleted: result.deleted, archived: result.archived };
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
