import { describe, expect, test } from "bun:test";
import { SessionLock } from "./session-lock.ts";

describe("Homeling session mutation admission", () => {
  test("locking and rotating invalidate retained actors without locking another browser", () => {
    const lock = new SessionLock();
    const a = lock.unlock("alice");
    const b = lock.unlock("alice");
    const actor = lock.admit(a.token, "alice");
    lock.lock(a.token, "alice");
    expect(() => lock.dispatch(actor, () => "write")).toThrow("session.locked");
    expect(lock.state(b.token, "alice").locked).toBe(false);
    const old = lock.admit(b.token, "alice");
    const rotated = lock.unlock("alice", b.token);
    expect(() => lock.dispatch(old, () => "write")).toThrow("session.locked");
    expect(lock.state(rotated.token, "mallory").locked).toBe(true);
    expect(new SessionLock().state(rotated.token, "alice").locked).toBe(true);
    expect(() => lock.dispatch({} as never, () => "write")).toThrow("session.locked");
  });
  test("reads do not renew idle and activity cannot exceed absolute or resurrect an expired lease", () => {
    let now = 0;
    const lock = new SessionLock({ now: () => now, idleMs: 100, absoluteMs: 200 });
    const a = lock.unlock("alice");
    now = 90;
    expect(lock.state(a.token, "alice").idleDeadline).toBe(100);
    expect(lock.activity(a.token, "alice").idleDeadline).toBe(190);
    now = 180;
    expect(lock.activity(a.token, "alice").idleDeadline).toBe(200);
    now = 200;
    expect(() => lock.activity(a.token, "alice")).toThrow("session.locked");
  });
  test("clock rollback closes all leases", () => {
    let now = 100;
    const lock = new SessionLock({ now: () => now });
    const a = lock.unlock("alice");
    now = 99;
    expect(lock.state(a.token, "alice").locked).toBe(true);
    now = 101;
    expect(lock.state(a.token, "alice").locked).toBe(true);
  });
  test("an idle-expired admission cannot dispatch, even without a browser lock request", () => {
    let now = 1_000;
    const lock = new SessionLock({ now: () => now, idleMs: 100, absoluteMs: 1_000 });
    const session = lock.unlock("alice");
    const actor = lock.admit(session.token, "alice");
    let writes = 0;
    lock.dispatch(actor, () => writes++);
    now = 1_100;
    expect(() => lock.dispatch(actor, () => writes++)).toThrow("session.locked");
    expect(writes).toBe(1);
  });
});
