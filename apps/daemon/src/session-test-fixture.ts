import { handleRequest } from "./index.ts";
import type { DaemonConfig } from "./config.ts";
import type { BridgeFetch } from "./bridge-proxy.ts";
import type { PersonaRuntime } from "./persona-service.ts";
import { SessionController } from "./session-controller.ts";
import { SessionLock } from "./session-lock.ts";
import { createDaemonSystemAdmissions } from "./system-admission.ts";
const secret = "a".repeat(43);
const fixtures = new WeakMap<DaemonConfig, { sessions: SessionController; cookies: Map<string, { cookie: string; epoch: number; generation: string }> }>();
/** Existing business-route tests explicitly authenticate against an injected, fake credential. */
export async function handleUnlockedRequest(req: Request & { remoteAddress?: string | null }, cfg: DaemonConfig, fetcher?: BridgeFetch, runtime?: PersonaRuntime): Promise<Response> {
  let fixture = fixtures.get(cfg);
  if (!fixture) { fixture = { sessions: new SessionController({ verify: () => (input) => input === secret }), cookies: new Map() }; fixtures.set(cfg, fixture); }
  const subject = req.headers.get("tailscale-user-login") ?? "local-operator";
  let cookie = fixture.cookies.get(subject);
  if (!cookie) {
    const unlocked = await fixture.sessions.handle(new Request("https://fixture/lite/api/session/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret }) }), subject);
    const state = await unlocked!.json() as { epoch: number; generation: string };
    cookie = { cookie: unlocked!.headers.get("set-cookie")!.split(";", 1)[0]!, epoch: state.epoch, generation: state.generation };
    fixture.cookies.set(subject, cookie);
  }
  req.headers.set("cookie", cookie.cookie);
  req.headers.set("x-homeling-session-epoch", String(cookie.epoch));
  req.headers.set("x-homeling-session-generation", cookie.generation);
  return handleRequest(req, cfg, fetcher, runtime, fixture.sessions);
}
export function fixtureAdmission() {
  const lock = new SessionLock(); const session = lock.unlock("fixture");
  return lock.admission(lock.admit(session.token, "fixture"));
}
export const fixtureRecovery = createDaemonSystemAdmissions().personaRecovery;
