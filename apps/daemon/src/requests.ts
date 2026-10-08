import {
  transitionRequest,
  upsertPendingRequest,
  type PendingRequest,
  type PendingRequestStatus,
  type RequestOption,
} from "@homeling/contracts";
import type { PaneWire, SnapshotResponse } from "@homeling/contracts";
import type { DaemonConfig } from "./config.ts";
import { proxyTargetUrl, type BridgeFetch } from "./bridge-proxy.ts";

const REQUEST_TTL_MS = 5 * 60_000;
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
const ANSI = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const OPTION = /^\s*(❯\s*)?(\d+)\.\s+(.+?)\s*$/;

interface DetectedOption extends RequestOption {
  readonly keys: readonly string[];
  readonly pointed: boolean;
}

export interface DetectedRequest {
  readonly kind: PendingRequest["kind"];
  readonly question: string;
  readonly subject: readonly string[];
  readonly signature: string;
  readonly identity: string;
  readonly options: readonly DetectedOption[];
  readonly preview: readonly string[];
  readonly footer: string;
  readonly pointedOptionId: string | null;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI, "").replace(/\r/g, "");
}

function isRule(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  return compact.length >= 3 && /^[─-╿▁-▔‒-―]+$/u.test(compact);
}

function operationAnchor(lines: string[], before: number): number | null {
  const from = Math.max(0, before - 256);
  for (let index = before - 1; index >= from; index--) {
    if (/^\s*(?:Bash command|Create file|Write file|Edit file|Fetch)\s*$/i.test(lines[index]!) ||
        /^\s*Claude wants to\b/i.test(lines[index]!) ||
        /^\s*Here is Claude's plan:\s*$/i.test(lines[index]!)) {
      return index;
    }
  }
  return null;
}

/** Conservative numbered-choice detector. Unrecognised/malformed screens never become actionable. */
export function detectPendingRequest(text: string): DetectedRequest | null {
  const lines = stripAnsi(text).split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !lines[end]!.trim()) end--;
  if (end < 0) return null;

  let kind: DetectedRequest["kind"] = "prompt-select";
  let optionEnd = end + 1;
  let footer = lines[end]!.trim();
  let notesIndex = -1;
  let planMarker = -1;
  const preview = /\bn to add notes\b/i.test(footer);
  if (preview) {
    // The preview note editor owns the keyboard. A numeric tap would type into the note and Enter
    // would submit it; never expose an approval card while that input is focused.
    if (/ctrl\+g to edit\b/i.test(footer)) return null;
    kind = "preview-select";
    for (let index = end - 1; index >= 0; index--) {
      if (/^\s*Notes:\s*/.test(lines[index]!)) {
        notesIndex = index;
        break;
      }
    }
    if (notesIndex < 0) return null;
    optionEnd = notesIndex;
  } else if (/\bEnter to select\b/i.test(footer)) {
    // `ctrl+g to edit` means a modal input owns the keyboard (e.g. multiselect Type something).
    if (/ctrl\+g to edit\b/i.test(footer)) return null;
    optionEnd = end;
  } else if (/\b(?:Tab to amend|Esc to cancel)\b/i.test(footer)) {
    kind = "prompt-select";
    optionEnd = end;
  } else {
    // Claude's plan footer can be followed by a separate plan-file path row.
    for (let index = end; index >= Math.max(0, end - 4); index--) {
      if (/ctrl\+g to edit\b|\/plans\/[^\s]+\.md/i.test(lines[index]!)) {
        planMarker = index;
        break;
      }
    }
    const tail = lines.slice(Math.max(0, end - 32), end + 1).join(" ");
    if (planMarker >= 0 && /ready\s+to\s+execute\.\s+would\s+you\s+like\s+to\s+proceed\?/i.test(tail)) {
      optionEnd = planMarker;
      footer = lines[planMarker]!.trim();
    } else if (isFooterlessPermission(lines, end)) {
      kind = "prompt-select";
      optionEnd = end + 1;
      footer = "";
    } else {
      return null;
    }
  }

  const previewColumn = preview ? lines[notesIndex]!.indexOf("Notes:") : -1;
  const numbered = lines.slice(0, optionEnd).flatMap((line, index) => {
    const optionText = preview ? line.slice(0, previewColumn) : line;
    const match = OPTION.exec(optionText);
    return match ? [{ id: match[2]!, label: match[3]!, keys: [match[2]!], pointed: Boolean(match[1]), index }] : [];
  });
  let start = numbered.length - 1;
  while (start > 0 && Number(numbered[start - 1]!.id) === Number(numbered[start]!.id) - 1) start--;
  const options = numbered.slice(start);
  if (options.length < 2 || options[0]!.id !== "1" || options.some((option, index) => option.id !== String(index + 1))) {
    return null;
  }
  // Herdr key parsing accepts single keys; fail closed rather than emit a card we cannot submit.
  if (options.length > 9) return null;
  const firstIndex = options[0]!.index;
  let questionIndex = -1;
  for (let index = firstIndex - 1; index >= 0; index--) {
    if (lines[index]!.includes("?")) {
      questionIndex = index;
      break;
    }
  }
  if (questionIndex < 0) return null;
  const question = lines[questionIndex]!.trim();
  const contextStart = Math.max(0, firstIndex - 40);
  const anchor = operationAnchor(lines, questionIndex);
  const ruleIndexes: number[] = [];
  for (let index = contextStart; index < questionIndex; index++) {
    if (isRule(lines[index]!)) ruleIndexes.push(index);
  }
  const subjectStart = anchor ?? (ruleIndexes.length >= 2
    ? ruleIndexes[ruleIndexes.length - 2]! + 1
    : ruleIndexes.length === 1 ? ruleIndexes[0]! + 1 : Math.max(0, firstIndex - 12));
  const subject = lines.slice(subjectStart, questionIndex).map((line) => line.trim()).filter(Boolean);
  // Bind Collie's expected_prompt to the entire visible pane context, not a 40-row option lookback.
  // A long command body may sit >40 rows above the options while its suffix is unchanged.
  const signature = lines.slice(0, end + 1).join("\n");
  const requestContext = lines.slice(0, questionIndex + 1)
    .map((line) => line.replace(/^\s*❯(?=\s)/, " "))
    .join("\n");
  if (!signature.trim() || signature.length > 32_768 || requestContext.length > 32_768) return null;
  const inputOptionIds = new Set(
    options.filter((option) => /\btype something\b/i.test(option.label)).map((option) => option.id),
  );
  // The pointer on a free-text row means digits are typed into the field, not sent as a choice.
  if (options.some((option) => inputOptionIds.has(option.id) && option.pointed)) return null;

  const planFeedbackIds = new Set<string>();
  if (planMarker >= 0 || /ctrl\+g to edit\b|\/plans\//i.test(footer)) {
    options.forEach((option, index) => {
      const nextOptionIndex = options[index + 1]?.index ?? optionEnd;
      const continuation = lines.slice(option.index + 1, nextOptionIndex)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");
      if (/^tell claude what to change\b/i.test(option.label) ||
          /shift\+tab\s+to\s+approve\s+with\s+this\s+feedback/i.test(continuation)) {
        planFeedbackIds.add(option.id);
      }
    });
    // The plan feedback row is an input, not an approval option; digits are typed into it when pointed.
    if (options.some((option) => planFeedbackIds.has(option.id) && option.pointed)) return null;
  }
  const nonActionableIds = new Set([...inputOptionIds, ...planFeedbackIds]);
  const actionableOptions = options.filter((option) => !nonActionableIds.has(option.id));
  if (actionableOptions.length === 0) return null;
  const mappedOptions = actionableOptions.map(({ index: _index, ...option }) => ({
    ...option,
    keys: kind === "preview-select" || /Enter to select/i.test(footer) ? [option.id, "Enter"] : [option.id],
  }));
  const previewLines = kind === "preview-select"
    ? lines.slice(firstIndex, notesIndex).map((line) => line.trimEnd().slice(Math.max(0, lines[notesIndex]!.indexOf("Notes:")))).filter(Boolean)
    : [];
  const payloadPreview = previewLines.filter((line) => line.trim()).map((line) => line.trim());
  const identity = JSON.stringify({
    kind,
    requestContext,
    question,
    options: mappedOptions.map(({ id, label }) => ({ id, label })),
  });
  return {
    kind,
    question,
    subject,
    signature,
    identity,
    options: mappedOptions,
    preview: payloadPreview,
    footer,
    pointedOptionId: mappedOptions.find((option) => option.pointed)?.id ?? null,
  };
}

function isFooterlessPermission(lines: string[], end: number): boolean {
  // This permission dialog has no hint footer. Its final No option, a pointer inside the same
  // contiguous numbered menu, and an immediately preceding permission question prove it is live.
  const lastOption = OPTION.exec(lines[end]!);
  if (!lastOption || !/^no\b/i.test(lastOption[3]!)) return false;
  const from = Math.max(0, end - 18);
  const rows = lines.slice(from, end + 1).flatMap((line, offset) => {
    const match = OPTION.exec(line);
    return match ? [{ index: from + offset, number: Number(match[2]), label: match[3]!, pointed: Boolean(match[1]) }] : [];
  });
  let start = rows.length - 1;
  while (start > 0 && rows[start - 1]!.number === rows[start]!.number - 1) start--;
  const menu = rows.slice(start);
  if (menu.length < 2 || menu[0]!.number !== 1 || menu[menu.length - 1]!.index !== end || !menu.some((row) => row.pointed)) {
    return false;
  }

  const firstOption = menu[0]!.index;
  let questionIndex = -1;
  for (let index = firstOption - 1; index >= Math.max(0, firstOption - 4); index--) {
    const text = lines[index]!.trim();
    if (/^do you want to\b/i.test(text)) {
      questionIndex = index;
      break;
    }
  }
  if (questionIndex < 0) return false;
  const question = lines.slice(questionIndex, firstOption).map((line) => line.trim()).filter(Boolean).join(" ");
  if (!/^do you want to\b/i.test(question) || !question.endsWith("?")) return false;
  return /^yes\b/i.test(menu[0]!.label) && /^no\b/i.test(menu[menu.length - 1]!.label);
}

interface RequestRecord {
  readonly request: PendingRequest;
  readonly signature: string;
  readonly identity: string;
}

/** In-memory request ledger; process nonce prevents stale cards colliding after daemon restart. */
export class PendingRequestStore {
  private readonly instanceId = crypto.randomUUID();
  private requests: PendingRequest[] = [];
  private readonly signatures = new Map<string, string>();
  private readonly identities = new Map<string, string>();
  private readonly actions = new Map<string, Map<string, readonly string[]>>();
  private readonly activeByPane = new Map<string, { id: string; identity: string }>();
  private readonly suppressedByPane = new Map<string, { identity: string; taskOccurrenceKey?: string }>();
  private readonly claimed = new Set<string>();
  private sequence = 0;
  private collectionGeneration = 0;

  beginCollection(): number {
    return ++this.collectionGeneration;
  }

  isCurrentCollection(generation: number): boolean {
    return generation === this.collectionGeneration;
  }

  observe(pane: PaneWire, detected: DetectedRequest | null, now = Date.now(), personaId?: string, taskOccurrenceKey?: string): PendingRequest | null {
    const active = this.activeByPane.get(pane.paneId);
    if (!detected) {
      if (active && this.claimed.has(active.id)) return null;
      if (active) this.settle(active.id, "resolved");
      this.suppressedByPane.delete(pane.paneId);
      this.expire(now);
      return null;
    }
    if (active?.identity === detected.identity && this.find(active.id)?.request.taskOccurrenceKey === taskOccurrenceKey) {
      this.signatures.set(active.id, detected.signature);
      const existing = this.requests.find((request) => request.id === active.id && request.status === "pending");
      if (!existing) {
        this.expire(now);
        return null;
      }
      const options = detected.options.map(({ id, label }) => ({ id, label }));
      const { personaId: _oldPersonaId, ...baseRequest } = existing;
      const ownedRequest = { ...baseRequest, ...(personaId ? { personaId } : {}) };
      const refreshed: PendingRequest = detected.kind === "preview-select"
        ? { ...ownedRequest, kind: "preview-select", payload: { question: detected.question, options, preview: detected.preview } }
        : { ...ownedRequest, kind: "prompt-select", payload: { question: detected.question, subject: detected.subject, options } };
      this.requests = upsertPendingRequest(this.requests, refreshed);
      this.actions.set(active.id, new Map(detected.options.map((option) => [option.id, option.keys])));
      this.expire(now);
      return refreshed;
    }
    if (active && this.claimed.has(active.id)) return null;
    if (active) this.settle(active.id, "expired");
    const suppressedIdentity = this.suppressedByPane.get(pane.paneId);
    if (suppressedIdentity?.identity === detected.identity && suppressedIdentity.taskOccurrenceKey === taskOccurrenceKey) {
      this.expire(now);
      return null;
    }
    if (suppressedIdentity) this.suppressedByPane.delete(pane.paneId);

    const id = `request:${this.instanceId}:${++this.sequence}`;
    const createdAt = new Date(now).toISOString();
    const options = detected.options.map(({ id, label }) => ({ id, label }));
    // The HTTP collection path supplies the daemon registry identity, not the workspace ID.
    const common = { id, paneId: pane.paneId, ...(personaId ? { personaId } : {}), ...(taskOccurrenceKey ? { taskOccurrenceKey } : {}), createdAt, status: "pending" as const };
    const request: PendingRequest = detected.kind === "preview-select"
      ? { ...common, kind: "preview-select", payload: { question: detected.question, options, preview: detected.preview } }
      : { ...common, kind: "prompt-select", payload: { question: detected.question, subject: detected.subject, options } };
    this.requests = upsertPendingRequest(this.requests, request);
    this.signatures.set(id, detected.signature);
    this.identities.set(id, detected.identity);
    this.actions.set(id, new Map(detected.options.map((option) => [option.id, option.keys])));
    this.activeByPane.set(pane.paneId, { id, identity: detected.identity });
    this.expire(now);
    return request;
  }

  listPending(now = Date.now()): PendingRequest[] {
    this.expire(now);
    return this.requests.filter((request) => request.status === "pending");
  }

  find(id: string): RequestRecord | null {
    const request = this.requests.find((candidate) => candidate.id === id);
    const signature = this.signatures.get(id);
    const identity = this.identities.get(id);
    return request && signature && identity ? { request, signature, identity } : null;
  }

  keysFor(id: string, optionId: string): readonly string[] | null {
    return this.actions.get(id)?.get(optionId) ?? null;
  }

  updatePendingBinding(id: string, paneId: string, identity: string, signature: string): boolean {
    const record = this.requests.find((request) => request.id === id);
    if (!record || record.status !== "pending" || record.paneId !== paneId || this.identities.get(id) !== identity) {
      return false;
    }
    this.signatures.set(id, signature);
    return true;
  }

  settle(id: string, status: Exclude<PendingRequestStatus, "pending">): PendingRequest | null {
    const existing = this.requests.find((request) => request.id === id);
    if (!existing) return null;
    this.requests = transitionRequest(this.requests, id, status);
    if (existing.status === "pending") {
      const active = this.activeByPane.get(existing.paneId);
      if (active?.id === id) this.activeByPane.delete(existing.paneId);
      const identity = this.identities.get(id);
      if (identity) this.suppressedByPane.set(existing.paneId, { identity, taskOccurrenceKey: existing.taskOccurrenceKey });
    }
    this.claimed.delete(id);
    return this.requests.find((request) => request.id === id) ?? null;
  }

  claim(id: string): boolean {
    const request = this.requests.find((candidate) => candidate.id === id);
    if (!request || request.status !== "pending" || this.claimed.has(id)) return false;
    this.claimed.add(id);
    return true;
  }

  releaseClaim(id: string): void {
    this.claimed.delete(id);
  }

  expirePaneRequest(paneId: string): void {
    const active = this.activeByPane.get(paneId);
    if (active && !this.claimed.has(active.id)) this.settle(active.id, "expired");
  }

  reconcileBlockedPanes(blockedPaneIds: ReadonlySet<string>): void {
    for (const [paneId, active] of this.activeByPane) {
      if (!blockedPaneIds.has(paneId) && !this.claimed.has(active.id)) this.settle(active.id, "resolved");
    }
    for (const paneId of this.suppressedByPane.keys()) {
      if (!blockedPaneIds.has(paneId)) this.suppressedByPane.delete(paneId);
    }
  }

  private expire(now: number): void {
    const cutoff = now - REQUEST_TTL_MS;
    for (const request of this.requests) {
      if (request.status === "pending" && !this.claimed.has(request.id) && Date.parse(request.createdAt) <= cutoff) {
        this.settle(request.id, "expired");
      }
    }
  }
}

async function upstreamJson<T>(url: string, fetcher: BridgeFetch, login: string | null = null): Promise<T | null> {
  const headers = new Headers({ accept: "application/json" });
  if (login) headers.set("tailscale-user-login", login);
  const response = await fetcher(url, { method: "GET", headers, redirect: "manual" });
  if (!response.ok) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function readPaneText(cfg: DaemonConfig, fetcher: BridgeFetch, paneId: string, login: string | null): Promise<string> {
  const response = await upstreamJson<{ text?: unknown; truncated?: boolean }>(
    proxyTargetUrl(`/lite/api/pane/${encodeURIComponent(paneId)}`, cfg), fetcher, login,
  );
  if (typeof response?.text !== "string" || response.truncated === true) throw new Error("complete pane screen unavailable");
  return response.text;
}

export async function collectPendingRequests(
  cfg: DaemonConfig,
  fetcher: BridgeFetch,
  store: PendingRequestStore,
  login: string | null = null,
  now = Date.now(),
  resolvePersona?: (pane: PaneWire) => Promise<string | { personaId: string; taskOccurrenceKey?: string } | undefined>,
): Promise<PendingRequest[]> {
  const generation = store.beginCollection();
  const snapshot = await upstreamJson<SnapshotResponse>(proxyTargetUrl("/lite/api/snapshot", cfg), fetcher, login);
  if (!snapshot) throw new Error("bridge snapshot unavailable");
  if (!store.isCurrentCollection(generation)) return store.listPending(now);
  const panes = [...snapshot.agents, ...snapshot.shellPanes];
  const blocked = panes.filter((pane) => pane.status === "blocked" && pane.kind !== "shell");
  const seen = new Set(blocked.map((pane) => pane.paneId));
  store.reconcileBlockedPanes(seen);
  for (const pane of blocked) {
    try {
      const read = await upstreamJson<{ text: string; truncated?: boolean }>(
        proxyTargetUrl(`/lite/api/pane/${encodeURIComponent(pane.paneId)}`, cfg), fetcher, login,
      );
      if (!store.isCurrentCollection(generation)) return store.listPending(now);
      if (!read) continue;
      if (read.truncated === true) {
        store.expirePaneRequest(pane.paneId);
        continue;
      }
      const detected = detectPendingRequest(read.text);
      if (detected) {
        const owner = resolvePersona ? await resolvePersona(pane) : undefined;
        if (!store.isCurrentCollection(generation)) return store.listPending(now);
        store.observe(pane, detected, now, typeof owner === 'string' ? owner : owner?.personaId, typeof owner === 'object' ? owner.taskOccurrenceKey : undefined);
      }
      else store.expirePaneRequest(pane.paneId);
    } catch {
      // A transient read failure is not evidence that the approval disappeared.
    }
  }
  return store.listPending(now);
}

export type ApprovalOutcome = {
  readonly status: PendingRequestStatus;
  readonly outcome: "submitted" | "unknown" | "already-handled" | "stale" | "not-submitted";
};

export type RequestSleep = (delayMs: number) => Promise<void>;
const PREVIEW_POLL_ATTEMPTS = 8;
const PREVIEW_POLL_DELAY_MS = 350;
const defaultRequestSleep: RequestSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

type KeyWriteResult = "sent" | "stale" | "not-submitted" | "unknown";

async function sendKeys(
  cfg: DaemonConfig,
  fetcher: BridgeFetch,
  paneId: string,
  keys: readonly string[],
  expectedPrompt: string,
  login: string | null,
): Promise<KeyWriteResult> {
  const url = proxyTargetUrl(`/lite/api/pane/${encodeURIComponent(paneId)}/keys`, cfg, "POST");
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  if (login) headers.set("tailscale-user-login", login);
  const response = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ keys, expected_prompt: expectedPrompt }),
    redirect: "manual",
  });
  let result: { ok?: boolean; code?: string } = {};
  try {
    result = await response.json() as { ok?: boolean; code?: string };
  } catch {
    // Keep the HTTP status as the only signal when the bridge returned a non-JSON response.
  }
  if (result.code === "prompt.read_failed") return "not-submitted";
  if (response.status === 409 || result.code === "prompt_changed") return "stale";
  if (!response.ok) return "unknown";
  return result.ok === true ? "sent" : "unknown";
}

/** Only report a retryable refusal while the same pane/request is still pending in the ledger. */
function notSubmittedOutcome(
  store: PendingRequestStore,
  record: RequestRecord,
  id: string,
  signature?: string,
): ApprovalOutcome {
  store.releaseClaim(id);
  if (signature) store.updatePendingBinding(id, record.request.paneId, record.identity, signature);
  const current = store.find(id);
  if (!current) return { status: "expired", outcome: "stale" };
  if (current.request.status === "pending" && current.request.paneId === record.request.paneId &&
      current.identity === record.identity) {
    return { status: "pending", outcome: "not-submitted" };
  }
  return {
    status: current.request.status,
    outcome: current.request.status === "resolved" ? "already-handled" : "stale",
  };
}

/** Submit one selected option once; no client-supplied pane path or arbitrary keystrokes are accepted. */
export async function approvePendingRequest(
  cfg: DaemonConfig,
  fetcher: BridgeFetch,
  store: PendingRequestStore,
  id: string,
  optionId: string,
  now = Date.now(),
  login: string | null = null,
  sleep: RequestSleep = defaultRequestSleep,
): Promise<ApprovalOutcome> {
  store.listPending(now);
  const record = store.find(id);
  if (!record) return { status: "expired", outcome: "stale" };
  if (record.request.status !== "pending") {
    return { status: record.request.status, outcome: "already-handled" };
  }
  const option = record.request.payload.options.find((candidate) => candidate.id === optionId);
  const optionKeys = store.keysFor(id, optionId);
  if (!option || !optionKeys) {
    store.settle(id, "expired");
    return { status: "expired", outcome: "stale" };
  }

  let currentText: string;
  try {
    currentText = await readPaneText(cfg, fetcher, record.request.paneId, login);
  } catch {
    // No write was attempted: preserve retryability only if concurrent collection still sees it pending.
    return notSubmittedOutcome(store, record, id);
  }
  const detected = detectPendingRequest(currentText);
  if (!detected || detected.signature !== record.signature || detected.identity !== record.identity) {
    store.settle(id, "expired");
    return { status: "expired", outcome: "stale" };
  }
  if (!store.claim(id)) return { status: "pending", outcome: "already-handled" };

  try {
    if (record.request.kind === "preview-select") {
      // Preview select digits move the pointer only. Wait for the same request to repaint at the
      // selected row before committing Enter, as Collie's pollDialog does.
      const moved = await sendKeys(cfg, fetcher, record.request.paneId, [option.id], record.signature, login);
      if (moved === "stale") {
        store.settle(id, "expired");
        return { status: "expired", outcome: "stale" };
      }
      if (moved === "not-submitted") return notSubmittedOutcome(store, record, id);
      if (moved === "unknown") {
        store.settle(id, "resolved");
        return { status: "resolved", outcome: "unknown" };
      }

      let pointed: DetectedRequest | null = null;
      let lastSameRequest: DetectedRequest | null = null;
      for (let attempt = 0; attempt < PREVIEW_POLL_ATTEMPTS; attempt++) {
        await sleep(PREVIEW_POLL_DELAY_MS);
        let afterMove: string;
        try {
          afterMove = await readPaneText(cfg, fetcher, record.request.paneId, login);
        } catch {
          continue;
        }
        const candidate = detectPendingRequest(afterMove);
        if (!candidate) continue;
        if (candidate.identity !== record.identity || candidate.kind !== record.request.kind) {
          store.settle(id, "expired");
          return { status: "expired", outcome: "stale" };
        }
        lastSameRequest = candidate;
        if (candidate.pointedOptionId === option.id) {
          pointed = candidate;
          break;
        }
      }
      if (!pointed) {
        // Enter was never sent. Reconcile against the ledger because a concurrent collection may
        // already have expired this id while reading a truncated/redrawing screen.
        return notSubmittedOutcome(store, record, id, lastSameRequest?.signature);
      }

      const currentRecord = store.find(id);
      if (!currentRecord || currentRecord.request.paneId !== record.request.paneId ||
          currentRecord.identity !== record.identity || currentRecord.request.status !== "pending") {
        store.settle(id, "expired");
        return { status: "expired", outcome: "stale" };
      }
      const committed = await sendKeys(cfg, fetcher, record.request.paneId, ["Enter"], pointed.signature, login);
      if (committed === "stale") {
        store.settle(id, "expired");
        return { status: "expired", outcome: "stale" };
      }
      if (committed === "not-submitted") return notSubmittedOutcome(store, record, id, pointed.signature);
      store.settle(id, "resolved");
      return { status: "resolved", outcome: committed === "sent" ? "submitted" : "unknown" };
    }

    const sent = await sendKeys(cfg, fetcher, record.request.paneId, optionKeys, record.signature, login);
    if (sent === "stale") {
      store.settle(id, "expired");
      return { status: "expired", outcome: "stale" };
    }
    if (sent === "not-submitted") return notSubmittedOutcome(store, record, id);
    store.settle(id, "resolved");
    return { status: "resolved", outcome: sent === "sent" ? "submitted" : "unknown" };
  } catch {
    // A write may have landed before a network failure; resolve to prevent a dangerous duplicate tap.
    store.settle(id, "resolved");
    return { status: "resolved", outcome: "unknown" };
  }
}
