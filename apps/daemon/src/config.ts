/**
 * Daemon configuration. Everything is environment-driven so the launchd plist stays a static
 * file (ADR-0001) and the same binary runs unchanged in tests and CI.
 */
import { join } from "node:path";
import { homedir } from "node:os";

export interface DaemonConfig {
  /** Loopback listen port (default 8790, per PRD §3 / ADR-0004). */
  readonly port: number;
  /** Host to bind. Loopback only: tailscale serve does the TLS front door. */
  readonly hostname: string;
  /** Absolute path of the web build output to serve at /lite/. */
  readonly webDist: string;
  /** SPA entry file name inside webDist. */
  readonly indexHtml: string;
  /** Tailscale logins allowed through; empty means deny all non-loopback callers. */
  readonly trustedUsers: readonly string[];
  /** The node's tailscale DNS name (no port), accepted in the Host allowlist. */
  readonly tailscaleHost: string;
  /** Operator opt-out mirroring Collie's COLLIE_ALLOW_ANY_HOST. */
  readonly allowAnyHost: boolean;
  /**
   * Origin of the Collie bridge the daemon re-proxies /api/* from (ADR-0005). Loopback only —
   * the proxy hop never leaves this machine, and the bridge's own gate stays authoritative.
   */
  readonly bridgeOrigin: string;
  /** Persistent daemon-owned persona registry. */
  readonly registryPath: string;
  /** Persistent task ownership and observation history; defaults alongside the registry. */
  readonly activityPath?: string;
  /** External independent push state/VAPID directory. */
  readonly pushDataDir?: string;
  /** Required VAPID contact; unset disables push without touching Collie. */
  readonly pushSubject?: string;
  /** Herdr Unix socket path (HERDR_SOCKET_PATH-compatible). */
  readonly herdrSocketPath: string;
  /** Owner-only local unlock state, never inside Collie or the repository. */
  readonly unlockDataDir?: string;
  /** Explicit localhost-only HTTP development mode; never inferred from proxy headers. */
  readonly sessionDevHttp?: boolean;
}

const DEFAULT_PORT = 8790;
const DEFAULT_BRIDGE_ORIGIN = "http://127.0.0.1:8787";

function repoRoot(): string {
  // apps/daemon/src/config.ts → repo root is three levels up.
  return join(import.meta.dir, "..", "..", "..");
}

function readPort(v: string | undefined): number {
  if (!v) return DEFAULT_PORT;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function readBridgeOrigin(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_BRIDGE_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("HOMELING_BRIDGE_ORIGIN must be a loopback HTTP origin");
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("HOMELING_BRIDGE_ORIGIN must be a loopback HTTP origin");
  }
  return url.origin;
}

export function daemonConfigFromEnv(env: Record<string, string | undefined>): DaemonConfig {
  const port = readPort(env.HOMELING_PORT ?? process.env.HOMELING_PORT);
  const webDist = env.HOMELING_WEB_DIST ?? process.env.HOMELING_WEB_DIST ?? join(repoRoot(), "apps", "web", "dist");
  const trustedUsers = (env.HOMELING_TRUSTED_USERS ?? process.env.HOMELING_TRUSTED_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tailscaleHost = (env.HOMELING_TAILSCALE_HOST ?? process.env.HOMELING_TAILSCALE_HOST ?? "").trim();
  const allowAnyHost = ["1", "true", "yes"].includes(
    (env.HOMELING_ALLOW_ANY_HOST ?? process.env.HOMELING_ALLOW_ANY_HOST ?? "").toLowerCase(),
  );
  const bridgeOrigin = readBridgeOrigin(env.HOMELING_BRIDGE_ORIGIN ?? process.env.HOMELING_BRIDGE_ORIGIN);
  return {
    port,
    hostname: "127.0.0.1",
    webDist,
    indexHtml: "index.html",
    trustedUsers,
    tailscaleHost,
    allowAnyHost,
    bridgeOrigin,
    activityPath: env.HOMELING_ACTIVITY_PATH ?? process.env.HOMELING_ACTIVITY_PATH,
    pushDataDir: env.HOMELING_PUSH_DIR ?? process.env.HOMELING_PUSH_DIR ?? join(homedir(), 'Library', 'Application Support', 'Homeling', 'push'),
    pushSubject: env.HOMELING_PUSH_SUBJECT ?? process.env.HOMELING_PUSH_SUBJECT,
    registryPath: env.HOMELING_REGISTRY_PATH ?? process.env.HOMELING_REGISTRY_PATH ?? join(homedir(), ".config", "homeling", "registry.json"),
    unlockDataDir: env.HOMELING_DATA_DIR ?? process.env.HOMELING_DATA_DIR ?? join(homedir(), "Library", "Application Support", "Homeling"),
    sessionDevHttp: (env.HOMELING_SESSION_DEV_HTTP ?? process.env.HOMELING_SESSION_DEV_HTTP) === "1",
    herdrSocketPath: env.HERDR_SOCKET_PATH ?? process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config", "herdr", "herdr.sock"),
  };
}
