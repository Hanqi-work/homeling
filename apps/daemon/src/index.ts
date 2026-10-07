/**
 * Persona daemon entrypoint: Bun HTTP server on loopback :8790 serving the /lite UI from the
 * web build output plus the /lite/api/* routes, all behind the self-held access gate
 * (ADR-0004: zero-touch — nothing under ~/.local/share/collie is read or written).
 */
import { checkAccess, type AccessConfig } from "./access.ts";
import { daemonConfigFromEnv, type DaemonConfig } from "./config.ts";
import { serveStatic, type StaticDir } from "./static.ts";

export const API_HEALTH_PATH = "/lite/api/health";

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

export async function handleRequest(
  req: Request & { remoteAddress?: string | null },
  cfg: DaemonConfig,
): Promise<Response> {
  const denied = checkAccess(req, accessConfigOf(cfg));
  if (!denied.ok) {
    return new Response(`${denied.reason}\n`, {
      status: denied.reason === "identity required" || denied.reason === "identity not trusted" ? 401 : 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { pathname } = new URL(req.url);

  if (pathname === API_HEALTH_PATH || pathname === "/api/health") {
    return Response.json({ ok: true, service: "homeling-daemon" });
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
