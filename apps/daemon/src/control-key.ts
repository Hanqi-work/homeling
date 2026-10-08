import { paneControlIdentity, type PaneWire, type SnapshotResponse } from "@homeling/contracts";
import { proxyTargetUrl, type BridgeFetch } from "./bridge-proxy.ts";
import type { DaemonConfig } from "./config.ts";
import { detectPendingRequest, type PendingRequestStore } from "./requests.ts";

// Only cancellation gestures: never expose Enter, selection, or arbitrary modifier combinations.
const ACTIONS = { interrupt: "ctrl+c", escape: "Escape" } as const;
const states = new WeakMap<DaemonConfig, Map<string, { busy: boolean; unknown: boolean; until: number }>>();
function rejected(error: string, status = 409): Response {
  return Response.json({ outcome: "not-submitted", error }, { status });
}

export async function sendControlKey(req: Request, cfg: DaemonConfig, fetcher: BridgeFetch, store: PendingRequestStore): Promise<Response> {
  if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return rejected("application/json required", 415);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return rejected("bad body", 400);
    body = parsed as Record<string, unknown>;
  } catch { return rejected("bad body", 400); }
  if (Object.keys(body).some((key) => !["action", "identity", "confirmed"].includes(key)) ||
      typeof body.action !== "string" || !Object.hasOwn(ACTIONS, body.action) ||
      typeof body.identity !== "string" || body.identity.length > 4096 || body.confirmed !== true) {
    return rejected("Confirmed fixed cancellation action and pane identity required", 400);
  }
  const url = new URL(req.url);
  let target: string;
  try { target = proxyTargetUrl(url.pathname.replace(/\/control-key$/, "/keys") + url.search, cfg, "POST"); }
  catch { return rejected("invalid pane", 404); }
  if (url.search) return rejected("query not allowed", 400);
  const paneId = new URL(target).pathname.split("/")[3]!;
  let paneStates = states.get(cfg);
  if (!paneStates) { paneStates = new Map(); states.set(cfg, paneStates); }
  const previous = paneStates.get(paneId);
  if (previous?.unknown) return Response.json({ outcome: "unknown", error: "Previous key result is unknown; inspect the terminal, do not repeat" }, { status: 409 });
  if (previous?.busy || (previous && previous.until > Date.now())) return rejected("Key is in flight or cooling down", 429);
  const state = { busy: true, unknown: false, until: 0 };
  paneStates.set(paneId, state);
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  const login = req.headers.get("tailscale-user-login");
  if (login) headers.set("tailscale-user-login", login);
  let writeStarted = false;
  async function read(path: string): Promise<unknown> {
    const response = await fetcher(new URL(path, cfg.bridgeOrigin), { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Bridge read failed");
    return response.json();
  }
  async function currentPane(): Promise<PaneWire | null> {
    const value = await read("/api/snapshot") as Partial<SnapshotResponse> | null;
    if (value?.bridge !== "connected" || !Array.isArray(value.agents) || !Array.isArray(value.shellPanes)) return null;
    const matches = [...value.agents, ...value.shellPanes].filter((pane) => pane?.paneId === paneId);
    const pane = matches.length === 1 ? matches[0] : undefined;
    if (!pane || !["idle", "working"].includes(pane.status) ||
        ![pane.workspaceId, pane.tabId, pane.agent, pane.cwd].every((field) => typeof field === "string") ||
        paneControlIdentity(pane) !== body.identity || store.listPending().some((request) => request.paneId === paneId)) return null;
    return pane;
  }
  try {
    if (!await currentPane()) return rejected("Pane changed, unavailable, or awaiting approval");
    const screen = await read(`/api/pane/${paneId}`) as { paneId?: unknown; text?: unknown; truncated?: unknown } | null;
    if (screen?.paneId !== paneId || typeof screen.text !== "string" || !screen.text.trim() ||
        screen.text.length > 32768 || (screen.truncated !== undefined && screen.truncated !== false) || detectPendingRequest(screen.text)) {
      return rejected("Screen is unavailable, truncated, or awaiting approval");
    }
    if (!await currentPane()) return rejected("Pane changed or now awaiting approval");
    writeStarted = true;
    const response = await fetcher(target, { method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ keys: [ACTIONS[body.action as keyof typeof ACTIONS]], expected_prompt: screen.text }) });
    const result = await response.json() as { ok?: boolean; code?: string; error?: string };
    if (response.ok && result.ok === true) return Response.json({ outcome: "accepted" });
    if (["prompt_changed", "prompt.read_failed"].includes(result.code ?? "")) {
      return rejected(result.error ?? result.code!);
    }
    state.unknown = true;
    return Response.json({ outcome: "unknown", error: "Key result unknown; inspect the terminal, do not repeat" }, { status: 502 });
  } catch {
    state.unknown = writeStarted;
    return writeStarted
      ? Response.json({ outcome: "unknown", error: "Key result unknown; inspect the terminal, do not repeat" }, { status: 502 })
      : rejected("Bridge read failed; no key submitted", 502);
  } finally {
    state.busy = false;
    state.until = Date.now() + 750;
  }
}
