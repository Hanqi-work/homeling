import { createHash, randomBytes } from "node:crypto";

const actorBrand: unique symbol = Symbol("MutationActor");
export interface MutationActor {
  readonly [actorBrand]: true;
}
export interface MutationAdmission {
  assert(): void;
  dispatch<T>(effect: () => T): T;
}
interface Lease {
  readonly subject: string;
  readonly epoch: number;
  readonly absoluteDeadline: number;
  idleDeadline: number;
  locked: boolean;
}
export interface SessionState {
  readonly locked: boolean;
  readonly epoch?: number;
  readonly idleDeadline?: number;
  readonly absoluteDeadline?: number;
}
export class SessionLocked extends Error {
  constructor() { super("session.locked"); }
}
export function lockedResponse(): Response {
  return Response.json({ ok: false, error: "Unlock Homeling before making changes", code: "session.locked", executed: false, textDelivered: false, deliveryUnknown: false }, {
    status: 423, headers: { "cache-control": "no-store" },
  });
}
const verifier = (token: string) => createHash("sha256").update("homeling/session/v1\0").update(token).digest("hex");

/** Server-clock leases; dispatch validation and invocation occupy one synchronous turn. */
export class SessionLock {
  private readonly sessions = new Map<string, Lease>();
  private readonly actors = new WeakMap<MutationActor, Lease>();
  private epoch = 0;
  private lastNow = -Infinity;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  constructor(options: { now?: () => number; idleMs?: number; absoluteMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.absoluteMs = options.absoluteMs ?? 8 * 60 * 60_000;
  }
  private time(): number {
    const now = this.now();
    if (!Number.isFinite(now) || now < this.lastNow) {
      for (const lease of this.sessions.values()) lease.locked = true;
      throw new SessionLocked();
    }
    this.lastNow = now;
    return now;
  }
  private valid(lease: Lease): void {
    const now = this.time();
    if (lease.locked || now >= lease.idleDeadline || now >= lease.absoluteDeadline) {
      lease.locked = true;
      throw new SessionLocked();
    }
  }
  unlock(subject: string, previousToken?: string): { token: string; state: SessionState } {
    const now = this.time();
    if (previousToken) this.lock(previousToken, subject);
    const token = randomBytes(32).toString("base64url");
    const lease: Lease = { subject, epoch: ++this.epoch, locked: false, idleDeadline: now + this.idleMs, absoluteDeadline: now + this.absoluteMs };
    this.sessions.set(verifier(token), lease);
    return { token, state: this.state(token, subject) };
  }
  state(token: string | undefined, subject: string): SessionState {
    if (!token) return { locked: true };
    const lease = this.sessions.get(verifier(token));
    if (!lease || lease.subject !== subject) return { locked: true };
    try { this.valid(lease); } catch { return { locked: true, epoch: lease.epoch }; }
    return { locked: false, epoch: lease.epoch, idleDeadline: lease.idleDeadline, absoluteDeadline: lease.absoluteDeadline };
  }
  lock(token: string | undefined, subject: string): void {
    if (!token) return;
    const lease = this.sessions.get(verifier(token));
    if (lease?.subject === subject) lease.locked = true;
  }
  admit(token: string | undefined, subject: string): MutationActor {
    const lease = token ? this.sessions.get(verifier(token)) : undefined;
    if (!lease || lease.subject !== subject) throw new SessionLocked();
    this.valid(lease);
    const actor: MutationActor = { [actorBrand]: true };
    this.actors.set(actor, lease);
    return actor;
  }
  assert(actor: MutationActor): void {
    const lease = this.actors.get(actor);
    if (!lease) throw new SessionLocked();
    this.valid(lease);
  }
  admission(actor: MutationActor): MutationAdmission {
    return { assert: () => this.assert(actor), dispatch: <T>(effect: () => T): T => this.dispatch(actor, effect) };
  }
  dispatch<T>(actor: MutationActor, effect: () => T): T {
    this.assert(actor);
    return effect();
  }
  activity(token: string | undefined, subject: string): SessionState {
    const actor = this.admit(token, subject);
    const lease = this.actors.get(actor)!;
    lease.idleDeadline = Math.min(this.time() + this.idleMs, lease.absoluteDeadline);
    return this.state(token, subject);
  }
}
