/**
 * The /api/* wiring decision (ADR-0005) as code: the daemon re-proxies a narrow allowlist of
 * bridge endpoints, including the single user-reply write route, so the browser only talks to its own origin.
 *
 * The browser asks `/lite/api/...` (base-relative from the SPA) → tailscale forwards the full
 * path to the daemon → the daemon checks its own access gate → fetches the allowlisted bridge
 * endpoint on loopback. The bridge's identity gate stays authoritative for direct callers; the
 * proxy hop is loopback-to-loopback.
 */
import type { DaemonConfig } from "./config.ts";

/** Browser-facing prefix (full path, as the daemon receives it from tailscale serve). */
export const BROWSER_API_PREFIX = "/lite/api/";

export type BridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The narrow allowlist admits the snapshot/history read routes and only POST to pane reply.
 * Every other write/action is refused here rather than forwarded. The pane suffix check comes
 * before anything else, so a longer, wronger path can never inherit an allowlisted prefix's verdict.
 */
const SAFE_PANE_ID = /^[A-Za-z0-9._~:-]{1,128}$/;

export function allowBridgePath(bridgePath: string, method = "GET"): boolean {
  if (method === "GET" && bridgePath === "/api/snapshot") return true;
  const action = bridgePath.match(/^\/api\/pane\/([^/]+)\/(history|reply)$/);
  if (!action || (action[2] === "history" ? method !== "GET" : method !== "POST")) return false;
  const paneId = action[1]!;
  return paneId !== "." && paneId !== ".." && !paneId.includes("..") && SAFE_PANE_ID.test(paneId);
}

/**
 * Parse first, then validate the normalized final target. Only the snapshot route, pane history,
 * and pane reply survive URL dot-segment normalization. The pane id is decoded once and rejected
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
  if (incoming.pathname === "/lite/api/snapshot") {
    bridgePath = "/api/snapshot";
  } else {
    const pane = incoming.pathname.match(/^\/lite\/api\/pane\/([^/]+)\/(history|reply)$/);
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
    bridgePath = `/api/pane/${paneId}/${pane[2]}`;
  }

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

  if (req.method === "POST") {
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
    const body = req.method === "POST" ? await req.arrayBuffer() : undefined;
    const upstream = await fetcher(target, { method: req.method, headers, body, redirect: "manual" });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response("bridge unavailable\n", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export type { DaemonConfig };
