/**
 * The /api/* wiring decision (ADR-0005) as code: the daemon re-proxies narrow bridge reads/writes;
 * browser approval is mediated by request IDs rather than raw keys.
 *
 * The browser asks `/lite/api/...` (base-relative from the SPA) → tailscale forwards the full
 * path to the daemon → the daemon checks its own access gate → fetches the allowlisted bridge
 * endpoint on loopback. The bridge's identity gate stays authoritative for direct callers; the
 * proxy hop is loopback-to-loopback.
 */
import { SessionLocked } from "./session-lock.ts";
import { safeUpstreamFailure } from "./safe-error.ts";
import type { DaemonConfig } from "./config.ts";

/** Browser-facing prefix (full path, as the daemon receives it from tailscale serve). */
export const BROWSER_API_PREFIX = "/lite/api/";

export type BridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The narrow allowlist admits snapshot/pane/history/launcher reads, POST to pane reply or launch,
 * and internal POST keys. Browser key writes are blocked except for the fixed Ctrl-C stop semantic route.
 */
const SAFE_PANE_ID = /^[A-Za-z0-9._~:-]{1,128}$/;
const RESERVED_PANE_SEGMENTS = new Set(["history", "reply", "keys", "stop"]);
const LAUNCH_TIMEOUT_MS = 60_000;
const MAX_STT_BYTES = 8 * 1024 * 1024;
const STT_MEDIA_TYPES = new Set([
  "audio/webm", "audio/ogg", "application/ogg", "audio/mp4", "audio/m4a",
  "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav",
]);

async function readAudio(req: Request, signal: AbortSignal): Promise<ArrayBuffer | Response> {
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!STT_MEDIA_TYPES.has(mediaType)) return Response.json({ error: "Unsupported audio format" }, { status: 415 });
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_STT_BYTES) return Response.json({ error: "Recording too large" }, { status: 413 });
  if (!req.body) return Response.json({ error: "Empty recording" }, { status: 400 });
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cancellation: Promise<void> | undefined;
  const cancelReader = () => { cancellation = reader.cancel(); };
  signal.addEventListener("abort", cancelReader, { once: true });
  if (signal.aborted) cancelReader();
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_STT_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Recording too large" }, { status: 413 });
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", cancelReader);
    try { await cancellation; } finally { reader.releaseLock(); }
  }
  if (size === 0) return Response.json({ error: "Empty recording" }, { status: 400 });
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
  return audio.buffer;
}

export function allowBridgePath(bridgePath: string, method = "GET"): boolean {
  if (method === "GET" && ["/api/snapshot", "/api/launchers"].includes(bridgePath)) return true;
  if (bridgePath === "/api/launch" || bridgePath === "/api/stt") return method === "POST";
  const action = bridgePath.match(/^\/api\/pane\/([^/]+)(?:\/(history|reply|keys))?$/);
  if (!action) return false;
  const suffix = action[2];
  const paneId = action[1]!;
  const methodAllowed = suffix === undefined || suffix === "history" ? method === "GET" : method === "POST";
  return methodAllowed && paneId !== "." && paneId !== ".." && !paneId.includes("..") &&
    !RESERVED_PANE_SEGMENTS.has(paneId) && SAFE_PANE_ID.test(paneId);
}

/**
 * Parse first, then validate the normalized final target. Only the snapshot route, pane screen/history,
 * reply and internal keys targets survive URL dot-segment normalization. The pane id is decoded once and rejected
 * if decoding exposes a delimiter or another encoded layer.
 */
export function proxyTargetUrl(pathWithQuery: string, cfg: DaemonConfig, method = "GET"): string {
  if (!pathWithQuery.startsWith(BROWSER_API_PREFIX)) {
    throw new Error(`not a proxyable path: ${pathWithQuery}`);
  }

  const queryStart = pathWithQuery.indexOf("?");
  const rawPath = queryStart === -1 ? pathWithQuery : pathWithQuery.slice(0, queryStart);
  if (rawPath.includes("#") || rawPath.includes("\\")) {
    throw new Error(`not a proxyable path: ${pathWithQuery}`);
  }
  for (const segment of rawPath.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`not a proxyable path: ${pathWithQuery}`);
    }
    if (decoded === "." || decoded === ".." || /[\\/?#]/.test(decoded) || decoded.includes("%")) {
      throw new Error(`not a proxyable path: ${pathWithQuery}`);
    }
  }

  let incoming: URL;
  try {
    incoming = new URL(pathWithQuery, "http://daemon.invalid");
  } catch {
    throw new Error(`not a proxyable path: ${pathWithQuery}`);
  }
  if (incoming.origin !== "http://daemon.invalid" || incoming.hash) {
    throw new Error(`not a proxyable path: ${pathWithQuery}`);
  }

  let bridgePath: string;
  const stopRoute = incoming.pathname.match(/^\/lite\/api\/pane\/([^/]+)\/stop$/);
  if (stopRoute) {
    if (method !== "POST" || incoming.search) throw new Error(`not a proxyable path: ${pathWithQuery}`);
    const paneId = decodeURIComponent(stopRoute[1]!);
    if (/[\\/#?%]/.test(paneId) || paneId.includes("..") || RESERVED_PANE_SEGMENTS.has(paneId) || !SAFE_PANE_ID.test(paneId)) {
      throw new Error(`not a proxyable path: ${pathWithQuery}`);
    }
    bridgePath = `/api/pane/${paneId}/keys`;
  } else if (["/lite/api/snapshot", "/lite/api/launchers", "/lite/api/launch", "/lite/api/stt"].includes(incoming.pathname)) {
    bridgePath = incoming.pathname.slice("/lite".length);
  } else {
    const pane = incoming.pathname.match(/^\/lite\/api\/pane\/([^/]+)(?:\/(history|reply|keys))?$/);
    if (!pane) throw new Error(`not a proxyable path: ${pathWithQuery}`);
    let paneId: string;
    try {
      paneId = decodeURIComponent(pane[1]!);
    } catch {
      throw new Error(`not a proxyable path: ${pathWithQuery}`);
    }
    if (/[\\/#?%]/.test(paneId) || paneId.includes("..") || !SAFE_PANE_ID.test(paneId)) {
      throw new Error(`not a proxyable path: ${pathWithQuery}`);
    }
    bridgePath = `/api/pane/${paneId}${pane[2] ? `/${pane[2]}` : ""}`;
  }

  if (bridgePath === "/api/stt" && incoming.search) throw new Error(`not a proxyable path: ${pathWithQuery}`);
  if (!allowBridgePath(bridgePath, method)) throw new Error(`not a proxyable path: ${pathWithQuery}`);
  const target = new URL(bridgePath, cfg.bridgeOrigin);
  if (!allowBridgePath(target.pathname, method) || target.pathname !== bridgePath) {
    throw new Error(`not a proxyable path: ${pathWithQuery}`);
  }
  return `${target.origin}${target.pathname}${incoming.search}`;
}

export async function proxyBridgeRequest(
  req: Request,
  cfg: DaemonConfig,
  fetcher: BridgeFetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  let target: string;
  try {
    target = proxyTargetUrl(url.pathname + url.search, cfg, req.method);
  } catch {
    return new Response("not found\n", { status: 404 });
  }

  const isStopRoute = /^\/lite\/api\/pane\/[^/]+\/stop$/.test(url.pathname);
  // Arbitrary browser key writes remain blocked; stop is a fixed server-authored Ctrl-C action.
  if (req.method === "POST" && /\/api\/pane\/[^/]+\/keys$/.test(new URL(target).pathname) && !isStopRoute) {
    return new Response("not found\n", { status: 404 });
  }

  const isSttRoute = url.pathname === `${BROWSER_API_PREFIX}stt`;
  if (req.method === "POST" && !isSttRoute) {
    const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return new Response("application/json required\n", {
        status: 415,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  const headers = new Headers({ accept: req.headers.get("accept") ?? "application/json" });
  const login = req.headers.get("tailscale-user-login");
  if (login) headers.set("tailscale-user-login", login);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  try {
    let signal: AbortSignal | undefined;
    if (isSttRoute) signal = AbortSignal.any([req.signal, AbortSignal.timeout(120_000)]);
    else if (url.pathname === `${BROWSER_API_PREFIX}launch`) signal = AbortSignal.timeout(LAUNCH_TIMEOUT_MS);

    let body: BodyInit | undefined;
    if (req.method === "POST") {
      if (isSttRoute) {
        const audio = await readAudio(req, signal!);
        if (audio instanceof Response) return audio;
        body = audio;
      } else if (isStopRoute) body = new TextEncoder().encode('{"keys":["ctrl+c"]}');
      else body = await req.arrayBuffer();
    }
    const upstream = await fetcher(target, { method: req.method, headers, body, redirect: "manual", signal });
    if (!upstream.ok) {
      const outcome = await upstream.json().catch(() => null);
      return Response.json(safeUpstreamFailure(outcome, "Bridge request failed", "bridge.unavailable", req.method === "POST" && !isSttRoute), { status: upstream.status });
    }
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (error instanceof SessionLocked) throw error;
    if (isSttRoute) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return Response.json({ ok: false, error: timedOut ? "Transcription timed out" : "Transcription unavailable" }, { status: timedOut ? 504 : 502 });
    }
    if (url.pathname === `${BROWSER_API_PREFIX}launch`) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return Response.json(
        {
          ok: false,
          error: timedOut ? "Launch timed out; task status is unknown" : "Bridge unavailable",
          code: timedOut ? "launch.timeout" : "bridge.unavailable",
        },
        { status: timedOut ? 504 : 502 },
      );
    }
    return new Response("bridge unavailable\n", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export type { DaemonConfig };
