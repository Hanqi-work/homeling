/**
 * Persona daemon entrypoint: Bun HTTP server on loopback :8790 serving the /lite UI from the
 * web build output plus the /lite/api/* routes, all behind the self-held access gate
 * (ADR-0004: zero-touch — nothing under ~/.local/share/collie is read or written).
 */
import { checkAccess, isLoopbackRequest, type AccessConfig } from "./access.ts";
import { daemonConfigFromEnv, type DaemonConfig } from "./config.ts";
import { sendControlKey } from "./control-key.ts";
import { BROWSER_API_PREFIX, proxyBridgeRequest, type BridgeFetch } from "./bridge-proxy.ts";
import { approvePendingRequest, collectPendingRequests, PendingRequestStore } from "./requests.ts";
import { serveStatic, type StaticDir } from "./static.ts";

export const API_HEALTH_PATH = "/lite/api/health";
export const API_REQUESTS_PATH = "/lite/api/requests";

const requestStores = new WeakMap<DaemonConfig, PendingRequestStore>();
function requestStore(cfg: DaemonConfig): PendingRequestStore {
  let store = requestStores.get(cfg);
  if (!store) {
    store = new PendingRequestStore();
    requestStores.set(cfg, store);
  }
  return store;
}

export function accessConfigOf(c: DaemonConfig): AccessConfig {
  return {
    trustedUsers: c.trustedUsers,
    allowAnyHost: c.allowAnyHost,
    tailscaleHost: c.tailscaleHost,
  };
}

export function staticDirOf(c: DaemonConfig): StaticDir {
  return { root: c.webDist, indexHtml: c.indexHtml };
}

function hasTailscaleOrigin(req: Request, cfg: DaemonConfig): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === new URL(`https://${cfg.tailscaleHost}`).origin &&
      !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export async function handleRequest(
  req: Request & { remoteAddress?: string | null },
  cfg: DaemonConfig,
  fetcher: BridgeFetch = fetch,
): Promise<Response> {
  const denied = checkAccess(req, accessConfigOf(cfg));
  if (!denied.ok) {
    return new Response(`${denied.reason}\n`, {
      status: denied.reason === "identity required" || denied.reason === "identity not trusted" ? 401 : 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { pathname } = new URL(req.url);
  const isBridgeWritePost = req.method === "POST" && (
    pathname === `${BROWSER_API_PREFIX}launch` || /^\/lite\/api\/pane\/[^/]+\/(reply|keys|stop|control-key)$/.test(pathname)
  );
  const isApprovalPost = req.method === "POST" && /^\/lite\/api\/requests\/[^/]+\/approve$/.test(pathname);
  if ((isBridgeWritePost || isApprovalPost) && !isLoopbackRequest(req) && !hasTailscaleOrigin(req, cfg)) {
    return new Response("cross-origin rejected\n", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (pathname === API_HEALTH_PATH || pathname === "/api/health") {
    return Response.json({ ok: true, service: "homeling-daemon" });
  }

  const store = requestStore(cfg);
  if (req.method === "POST" && /^\/lite\/api\/pane\/[^/]+\/control-key$/.test(pathname)) {
    return sendControlKey(req, cfg, fetcher, store);
  }
  if (pathname === API_REQUESTS_PATH && req.method === "GET") {
    try {
      return Response.json(await collectPendingRequests(cfg, fetcher, store, req.headers.get("tailscale-user-login")));
    } catch {
      return Response.json({ error: "bridge unavailable" }, { status: 502 });
    }
  }
  const approvalMatch = pathname.match(/^\/lite\/api\/requests\/([^/]+)\/approve$/);
  if (approvalMatch && req.method === "POST") {
    const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return new Response("application/json required\n", {
        status: 415,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    let body: { optionId?: unknown };
    try {
      body = await req.json() as { optionId?: unknown };
    } catch {
      return Response.json({ error: "bad body" }, { status: 400 });
    }
    if (typeof body.optionId !== "string" || body.optionId.length === 0) {
      return Response.json({ error: "optionId required" }, { status: 400 });
    }
    let id: string;
    try {
      id = decodeURIComponent(approvalMatch[1]!);
    } catch {
      return Response.json({ error: "invalid request id" }, { status: 400 });
    }
    const outcome = await approvePendingRequest(
      cfg, fetcher, store, id, body.optionId, Date.now(), req.headers.get("tailscale-user-login"),
    );
    return Response.json(outcome, { status: outcome.status === "expired" ? 409 : 200 });
  }

  if (pathname.startsWith(BROWSER_API_PREFIX)) {
    if (req.method === "POST" && !isBridgeWritePost) {
      return new Response("method not allowed\n", { status: 405, headers: { allow: "GET" } });
    }
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response("method not allowed\n", { status: 405, headers: { allow: "GET, POST" } });
    }
    return proxyBridgeRequest(req, cfg, fetcher);
  }

  const staticRes = await serveStatic(req, staticDirOf(cfg));
  return staticRes ?? new Response("not found\n", { status: 404 });
}

export function startDaemon(cfg: DaemonConfig = daemonConfigFromEnv({})): ReturnType<typeof Bun.serve> {
  const fetch = (req: Request): Promise<Response> => {
    // Loopback trust comes from the peer address, not headers — read it from the server,
    // because `req.remoteAddress` is not populated on plain Bun.serve requests.
    const remoteAddress: string | null = server.requestIP(req)?.address ?? null;
    return handleRequest(Object.assign(req, { remoteAddress }), cfg);
  };
  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.hostname,
    fetch,
  });
  console.log(`[homeling-daemon] listening on http://${cfg.hostname}:${cfg.port} serving ${cfg.webDist} at /lite/`);
  return server;
}

// Entrypoint when run directly (`bun run src/index.ts`); skipped under bun test.
if (import.meta.main && !process.env.BUN_TEST) {
  startDaemon();
}
