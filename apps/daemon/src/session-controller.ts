import { randomBytes } from "node:crypto";
import { SessionLock, SessionLocked, lockedResponse, type MutationAdmission } from "./session-lock.ts";

export const SESSION_PATH = "/lite/api/session";
export const SESSION_COOKIE = "__Secure-homeling_session";
export const DEV_SESSION_COOKIE = "homeling_dev_session";
interface Bucket { start: number; attempts: number }
const noStore = { "cache-control": "no-store" };
async function readSmallJson(req: Request): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length && Number(length) > 1_024) throw new Error("body too large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("body required");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_024) throw new Error("body too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export class SessionController {
  readonly generation = randomBytes(16).toString("hex");
  private readonly lock: SessionLock;
  private readonly buckets = new Map<string, Bucket>();
  private active = 0;
  private readonly now: () => number;
  constructor(private readonly options: { verify: () => ((secret: string) => boolean) | null; devHttp?: boolean; now?: () => number; idleMs?: number; absoluteMs?: number }) {
    this.now = options.now ?? Date.now;
    this.lock = new SessionLock(options);
  }
  private token(req: Request): string | undefined {
    const name = this.options.devHttp ? DEV_SESSION_COOKIE : SESSION_COOKIE;
    const cookies = (req.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
    const values = cookies.filter((part) => part.startsWith(`${name}=`)).map((part) => part.slice(name.length + 1));
    return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]!) ? values[0] : undefined;
  }
  admission(req: Request, subject: string): MutationAdmission {
    return this.lock.admission(this.lock.admit(this.token(req), subject));
  }
  private consume(key: string, limit: number): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.start + 60_000) {
      bucket = { start: now, attempts: 0 }; this.buckets.set(key, bucket);
    }
    if (now < bucket.start || bucket.attempts >= limit) return false;
    bucket.attempts++;
    return true;
  }
  async handle(req: Request, subject: string): Promise<Response | undefined> {
    const { pathname } = new URL(req.url);
    if (pathname === SESSION_PATH && req.method === "GET") {
      return Response.json({ ...this.lock.state(this.token(req), subject), generation: this.generation, available: this.options.verify() !== null }, { headers: noStore });
    }
    if (req.method !== "POST" || ![`${SESSION_PATH}/unlock`, `${SESSION_PATH}/lock`, `${SESSION_PATH}/activity`].includes(pathname)) return undefined;
    if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return Response.json({ error: "application/json required" }, { status: 415, headers: noStore });
    if (pathname === `${SESSION_PATH}/lock`) {
      this.lock.lock(this.token(req), subject);
      return Response.json({ locked: true, generation: this.generation }, { headers: noStore });
    }
    if (pathname === `${SESSION_PATH}/activity`) {
      try { return Response.json({ ...this.lock.activity(this.token(req), subject), generation: this.generation }, { headers: noStore }); }
      catch { return lockedResponse(); }
    }
    // Count attempts before parsing/hashing, independent of cookie/session rotation.
    const global = this.consume("global", 10);
    const principal = this.consume(`subject:${subject}`, 5);
    if (!global || !principal || this.active >= 2) return Response.json({ error: "Too many unlock attempts", code: "session.rate_limited" }, { status: 429, headers: { ...noStore, "retry-after": "60" } });
    this.active++;
    try {
      const verify = this.options.verify();
      if (!verify) return Response.json({ locked: true, error: "Local unlock credentials are unavailable", code: "session.unavailable" }, { status: 503, headers: noStore });
      let body: { secret?: unknown };
      try { body = await readSmallJson(req) as { secret?: unknown }; } catch { return Response.json({ error: "Invalid unlock body (maximum 1KiB)" }, { status: 400, headers: noStore }); }
      if (!body || typeof body.secret !== "string" || body.secret.length !== 43 || !verify(body.secret)) return Response.json({ locked: true, code: "session.invalid_secret" }, { status: 401, headers: noStore });
      const unlocked = this.lock.unlock(subject, this.token(req));
      const name = this.options.devHttp ? DEV_SESSION_COOKIE : SESSION_COOKIE;
      const cookie = `${name}=${unlocked.token}; Path=/lite/; HttpOnly; SameSite=Strict${this.options.devHttp ? "" : "; Secure"}; Max-Age=28800`;
      return Response.json({ ...unlocked.state, generation: this.generation }, { headers: { ...noStore, "set-cookie": cookie } });
    } catch (error) {
      if (error instanceof SessionLocked) return lockedResponse();
      return Response.json({ locked: true, code: "session.unavailable" }, { status: 503, headers: noStore });
    } finally { this.active--; }
  }
}
