/**
 * Self-held access gate for the persona daemon, semantically aligned with Collie's
 * `checkAccess` (bridge/server.ts:1113-1151) — reimplemented, not shared (zero-touch,
 * ADR-0004: we read no Collie code at runtime and write nothing into its checkout).
 *
 * Layers, evaluated in order:
 *   1. Host allowlist (always on, before Origin) — defeats DNS rebinding.
 *   2. Same-origin / CSRF — Origin compared against Host; a write with no Origin from a
 *      non-loopback Host is not a browser request.
 *   3. Tailscale identity — `Tailscale-User-Login` must name a trusted user; loopback
 *      callers are trusted by address. Fail-closed: a non-loopback request with no
 *      identity header is refused, never waved through.
 */

/** Loopback forms of a Host header (Collie: `access-jwt.ts` LOOPBACK_HOST). */
const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)(:\d+)?$/i;

/** Methods that mutate state, treated as Collie's `level: "write"`. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AccessConfig {
  /** Tailscale logins allowed through the front door. Empty list = deny all remote callers. */
  readonly trustedUsers: readonly string[];
  /** Operator opt-out mirroring Collie's COLLIE_ALLOW_ANY_HOST. The identity check is never skipped. */
  readonly allowAnyHost?: boolean;
  /** The node's tailscale DNS name, e.g. `host.tail0000.ts.net`. Accepted (any port) as a Host header. */
  readonly tailscaleHost: string;
}

export type AccessDecision = { ok: true } | { ok: false; reason: string };

function isLoopbackAddress(remoteAddress: string | null): boolean {
  if (!remoteAddress) return false;
  // Bun reports IPv6-mapped IPv4 as "::ffff:127.0.0.1" / "::ffff:127.0.0.1%lo0".
  const addr = remoteAddress.toLowerCase().replace(/^::ffff:/, "").split("%")[0]!;
  return addr === "::1" || addr === "[::1]" || addr.startsWith("127.");
}

/** Host-header allowlist: loopback forms always pass, otherwise only the configured tailscale host. */
function isHostAllowed(host: string, cfg: AccessConfig): boolean {
  if (LOOPBACK_HOST.test(host)) return true;
  if (cfg.allowAnyHost) return true;
  if (!cfg.tailscaleHost) return false;
  const bare = host.toLowerCase();
  const bareNoPort = bare.replace(/:\d+$/, "");
  const allowed = cfg.tailscaleHost.toLowerCase();
  return bare === allowed || bareNoPort === allowed;
}

/**
 * The access gate. `req.remoteAddress` (a Bun extension) decides loopback trust; everything
 * else is plain headers, so tests can forge Requests directly.
 */
export function checkAccess(
  req: Request & { remoteAddress?: string | null },
  cfg: AccessConfig,
  level: "read" | "write" = WRITE_METHODS.has(req.method) ? "write" : "read",
): AccessDecision {
  const host = req.headers.get("host") ?? "";

  // 1. Host allowlist — ALWAYS first, so a rebinding request (Host == Origin == evil) never
  //    reaches the Origin logic.
  if (!cfg.allowAnyHost && !isHostAllowed(host, cfg)) {
    return { ok: false, reason: "host not allowed" };
  }

  // 2. Same-origin (CSRF), mirroring Collie checkAccess.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return { ok: false, reason: "bad origin" };
    }
    const allowed =
      originHost === host ||
      originHost.replace(/:\d+$/, "") === host.replace(/:\d+$/, "") ||
      LOOPBACK_HOST.test(originHost) ||
      LOOPBACK_HOST.test(host);
    if (!allowed) return { ok: false, reason: "cross-origin rejected" };
  } else if (level === "write" && !LOOPBACK_HOST.test(host) && !isLoopbackAddress(req.remoteAddress ?? null)) {
    // A write with no Origin header from a non-loopback caller isn't a real browser request.
    return { ok: false, reason: "origin required" };
  }

  // 3. Tailscale identity. Loopback is trusted by address — a header can never revoke that,
  //    and a header can never substitute for it: no identity + non-loopback = refused.
  if (isLoopbackAddress(req.remoteAddress ?? null)) return { ok: true };

  const login = req.headers.get("tailscale-user-login");
  if (!login) return { ok: false, reason: "identity required" };
  if (!cfg.trustedUsers.includes(login)) return { ok: false, reason: "identity not trusted" };
  return { ok: true };
}
