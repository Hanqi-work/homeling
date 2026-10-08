/**
 * The /api/* wiring decision (ADR-0005) as code: the daemon re-proxies a narrow, read-only
 * allowlist of bridge endpoints, so the browser only ever talks to its own origin.
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
 * The narrow allowlist: a bridge path proxies only when it is exactly a read route or a pane's
 * read sub-action. Anything else — writes, chat, whatever the bridge grows later — is refused
 * here rather than forwarded. The pane suffix check comes before anything else, so a longer,
 * wronger path can never inherit an allowlisted prefix's verdict.
 */
const SAFE_PANE_ID = /^[A-Za-z0-9._~:-]{1,128}$/;

export function allowBridgePath(bridgePath: string): boolean {
  if (bridgePath === "/api/snapshot") return true;
  const pane = bridgePath.match(/^\/api\/pane\/([^/]+)\/history$/);
  if (!pane) return false;
  const paneId = pane[1]!;
  return paneId !== "." && paneId !== ".." && !paneId.includes("..") && SAFE_PANE_ID.test(paneId);
}

/**
 * Parse first, then validate the normalized final target. Only the snapshot route and a single
 * pane-id segment ending in `/history` survive URL dot-segment normalization. The pane id is
 * decoded once and rejected if decoding exposes a delimiter or another encoded layer.
 */
export function proxyTargetUrl(pathWithQuery: string, cfg: DaemonConfig): string {
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
    const pane = incoming.pathname.match(/^\/lite\/api\/pane\/([^/]+)\/history$/);
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
    bridgePath = `/api/pane/${paneId}/history`;
  }

  if (!allowBridgePath(bridgePath)) throw new Error(`not a proxyable path: ${pathWithQuery}`);
  const target = new URL(bridgePath, cfg.bridgeOrigin);
  if (!allowBridgePath(target.pathname) || target.pathname !== bridgePath) {
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
    target = proxyTargetUrl(url.pathname + url.search, cfg);
  } catch {
    return new Response("not found\n", { status: 404 });
  }

  const headers = new Headers({ accept: req.headers.get("accept") ?? "application/json" });
  const login = req.headers.get("tailscale-user-login");
  if (login) headers.set("tailscale-user-login", login);

  try {
    const upstream = await fetcher(target, { method: "GET", headers, redirect: "manual" });
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
