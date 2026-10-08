/**
 * Persona daemon entrypoint: Bun HTTP server on loopback :8790 serving the /lite UI from the
 * web build output plus the /lite/api/* routes, all behind the self-held access gate
 * (ADR-0004: zero-touch — nothing under ~/.local/share/collie is read or written).
 */
import { checkAccess, isLoopbackRequest, type AccessConfig } from "./access.ts";
import { daemonConfigFromEnv, type DaemonConfig } from "./config.ts";
import { BROWSER_API_PREFIX, proxyBridgeRequest, type BridgeFetch } from "./bridge-proxy.ts";
import { approvePendingRequest, collectPendingRequests, PendingRequestStore } from "./requests.ts";
import { serveStatic, type StaticDir } from "./static.ts";
import { HerdrRpcError, HerdrSocketClient } from "./herdr-client.ts";
import { PersonaRegistry } from "./persona-registry.ts";
import {
  createEventObserver, createPersona, deletePersona, launchPersonaTask, listPersonas, recoverPersonas,
  sendPersonaMessage, updatePersona, validatePersonaInput, validatePersonaPatch, type PersonaRuntime,
} from "./persona-service.ts";

import { createDaemonSystemAdmissions } from "./system-admission.ts";
import { SessionController } from "./session-controller.ts";
import { SessionLocked, lockedResponse, type MutationAdmission } from "./session-lock.ts";
import { loadUnlockVerifier } from "./unlock-credentials.ts";

const sessionControllers = new WeakMap<DaemonConfig, SessionController>();
function sessionController(cfg: DaemonConfig): SessionController {
  let controller = sessionControllers.get(cfg);
  if (!controller) {
    controller = new SessionController({ devHttp: cfg.sessionDevHttp, verify: () => cfg.unlockDataDir ? loadUnlockVerifier(cfg.unlockDataDir) : null });
    sessionControllers.set(cfg, controller);
  }
  return controller;
}
function mutationOriginAllowed(req: Request & { remoteAddress?: string | null }, cfg: DaemonConfig): boolean {
  if (!cfg.sessionDevHttp) return hasTailscaleOrigin(req, cfg);
  if (!isLoopbackRequest(req) || req.headers.has("tailscale-user-login")) return false;
  return req.headers.get("origin") === `http://localhost:${cfg.port}` && new URL(req.url).hostname === "localhost";
}

export const API_HEALTH_PATH = "/lite/api/health";
export const API_REQUESTS_PATH = "/lite/api/requests";
export const API_PERSONA_PATH = "/lite/api/persona";

const personaRuntimes = new WeakMap<DaemonConfig, PersonaRuntime>();
function personaRuntime(cfg: DaemonConfig, fetcher: BridgeFetch): PersonaRuntime {
  let runtime = personaRuntimes.get(cfg);
  if (!runtime) {
    runtime = {
      cfg,
      fetcher,
      registry: new PersonaRegistry(cfg.registryPath),
      herdr: new HerdrSocketClient({ socketPath: cfg.herdrSocketPath }),
    };
    personaRuntimes.set(cfg, runtime);
  }
  return runtime;
}

function isPersonaWrite(pathname: string): boolean {
  return pathname === API_PERSONA_PATH || /^\/lite\/api\/persona\/[^/]+(?:\/message)?$/.test(pathname);
}

function jsonRequired(req: Request): boolean {
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

async function readJson(req: Request): Promise<unknown | null> {
  try { return await req.json(); } catch { return null; }
}


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
  runtimeOverride?: PersonaRuntime,
  sessionOverride?: SessionController,
): Promise<Response> {
  const denied = checkAccess(req, accessConfigOf(cfg));
  if (!denied.ok) {
    return new Response(`${denied.reason}\n`, {
      status: denied.reason === "identity required" || denied.reason === "identity not trusted" ? 401 : 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { pathname } = new URL(req.url);
  const isMutation = req.method !== "GET" && req.method !== "HEAD";
  if (isMutation && !mutationOriginAllowed(req, cfg)) {
    return new Response("cross-origin rejected\n", { status: 403 });
  }
  const sessions = sessionOverride ?? sessionController(cfg);
  const subject = req.headers.get("tailscale-user-login") ?? "local-operator";
  const sessionResponse = await sessions.handle(req, subject);
  if (sessionResponse) return sessionResponse;
  let admission: MutationAdmission | undefined;
  let dispatched = false;
  const sessionRefusal = () => dispatched ? Response.json({ ok: false, code: "session.interrupted", executed: true, textDelivered: null, deliveryUnknown: true, error: "Locked during an operation; reconcile before retrying" }, { status: 423, headers: { "cache-control": "no-store" } }) : lockedResponse();
  if (isMutation) {
    try {
      const admitted = sessions.admission(req, subject);
      admission = { assert: () => admitted.assert(), dispatch<T>(effect: () => T): T { return admitted.dispatch(() => { dispatched = true; return effect(); }); } };
    } catch { return lockedResponse(); }
  }
  const upstreamFetch = fetcher;
  fetcher = (target, init) => {
    const method = init?.method ?? "GET";
    return method === "GET" || method === "HEAD" ? upstreamFetch(target, init) : admission!.dispatch(() => upstreamFetch(target, init));
  };
  const isBridgeWritePost = req.method === "POST" && (
    pathname === `${BROWSER_API_PREFIX}launch` || /^\/lite\/api\/pane\/[^/]+\/(reply|keys|stop)$/.test(pathname)
  );
  const isApprovalPost = req.method === "POST" && /^\/lite\/api\/requests\/[^/]+\/approve$/.test(pathname);
  const isPersonaWriteRequest = isPersonaWrite(pathname) && req.method !== "GET";
  if ((isBridgeWritePost || isApprovalPost || isPersonaWriteRequest) && !isLoopbackRequest(req) && !hasTailscaleOrigin(req, cfg)) {
    return new Response("cross-origin rejected\n", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (pathname === API_HEALTH_PATH || pathname === "/api/health") {
    return Response.json({ ok: true, service: "homeling-daemon" });
  }

  const runtime = runtimeOverride ?? personaRuntime(cfg, upstreamFetch);
  if (pathname === `${API_PERSONA_PATH}/list` && req.method === "GET") {
    try {
      return Response.json({ personas: await listPersonas(runtime) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Herdr snapshot unavailable", code: error instanceof HerdrRpcError ? error.code : "herdr.unavailable" }, { status: 502 });
    }
  }
  if (pathname === API_PERSONA_PATH && req.method === "POST") {
    if (!jsonRequired(req)) return Response.json({ error: "application/json required" }, { status: 415 });
    const input = validatePersonaInput(await readJson(req));
    if (!input) return Response.json({ error: "invalid persona" }, { status: 400 });
    try {
      const persona = await createPersona(runtime, input, req.headers.get("tailscale-user-login"), admission!);
      return Response.json({ persona: { ...persona, status: "active" } }, { status: 201 });
    } catch (error) {
      if (error instanceof SessionLocked) return sessionRefusal();
      return Response.json({ error: error instanceof Error ? error.message : "Persona creation failed", code: error instanceof HerdrRpcError ? error.code : "persona.create_failed" }, { status: 502 });
    }
  }
  const personaMessageMatch = pathname.match(/^\/lite\/api\/persona\/([^/]+)\/message$/);
  if (personaMessageMatch && req.method === "POST") {
    if (!jsonRequired(req)) return Response.json({ error: "application/json required" }, { status: 415 });
    const body = await readJson(req) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string" || body.text.trim().length === 0 || body.text.length > 100_000) {
      return Response.json({ error: "text required" }, { status: 400 });
    }
    let id: string;
    try { id = decodeURIComponent(personaMessageMatch[1]!); } catch { return Response.json({ error: "invalid persona id" }, { status: 400 }); }
    try { return await sendPersonaMessage(runtime, id, body.text, req.headers.get("tailscale-user-login"), admission!); }
    catch (error) { return error instanceof SessionLocked ? sessionRefusal() : Response.json({ error: error instanceof Error ? error.message : "Message delivery failed", code: "persona.message_failed" }, { status: 502 }); }
  }
  const personaMatch = pathname.match(/^\/lite\/api\/persona\/([^/]+)$/);
  if (personaMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    let id: string;
    try { id = decodeURIComponent(personaMatch[1]!); } catch { return Response.json({ error: "invalid persona id" }, { status: 400 }); }
    if (req.method === "PATCH") {
      if (!jsonRequired(req)) return Response.json({ error: "application/json required" }, { status: 415 });
      const patch = validatePersonaPatch(await readJson(req));
      if (!patch) return Response.json({ error: "invalid persona patch" }, { status: 400 });
      try {
        const persona = await updatePersona(runtime, id, patch, admission!);
        return persona ? Response.json({ persona }) : Response.json({ error: "persona not found" }, { status: 404 });
      } catch (error) { return error instanceof SessionLocked ? sessionRefusal() : Response.json({ error: error instanceof Error ? error.message : "Persona update failed", code: "persona.update_failed" }, { status: 502 }); }
    }
    try {
      const result = await deletePersona(runtime, id, admission!);
      return result.deleted ? Response.json(result) : Response.json({ error: "persona not found" }, { status: 404 });
    } catch (error) { return error instanceof SessionLocked ? sessionRefusal() : Response.json({ error: error instanceof Error ? error.message : "Persona delete failed", code: "persona.delete_failed" }, { status: 502 }); }
  }
  if (isPersonaWrite(pathname) && req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") {
    return new Response("method not allowed\\n", { status: 405, headers: { allow: "GET, POST, PATCH, DELETE" } });
  }

  const store = requestStore(cfg);
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

  if (pathname === `${BROWSER_API_PREFIX}launch` && req.method === "POST") {
    const body = await req.clone().json().catch(() => null) as { personaId?: unknown; command?: unknown } | null;
    if (body && Object.hasOwn(body, "personaId")) {
      if (!jsonRequired(req)) return Response.json({ ok: false, error: "application/json required", code: "request.content_type" }, { status: 415 });
      if (typeof body.personaId !== "string" || typeof body.command !== "string") {
        return Response.json({ ok: false, error: "personaId and command required", code: "request.invalid" }, { status: 400 });
      }
      return launchPersonaTask(runtime, body.personaId, body.command, req.headers.get("tailscale-user-login"), admission!);
    }
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
  const runtime = personaRuntime(cfg, globalThis.fetch);
  const system = createDaemonSystemAdmissions();
  void recoverPersonas(runtime, system.personaRecovery).catch((error: unknown) => {
    console.error(`[homeling-daemon] persona recovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
  createEventObserver(runtime, system.personaRecovery);
  console.log(`[homeling-daemon] listening on http://${cfg.hostname}:${cfg.port} serving ${cfg.webDist} at /lite/`);
  return server;
}

// Entrypoint when run directly (`bun run src/index.ts`); skipped under bun test.
if (import.meta.main && !process.env.BUN_TEST) {
  startDaemon();
}
