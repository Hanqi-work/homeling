import { expect, test } from "bun:test";
import { SessionLock } from "./session-lock.ts";
import { dispatchTaskCreation } from "./mutation-result.ts";
test("already-dispatched task creation may register that pane once after lock, without granting another launch", async () => {
  const lock = new SessionLock(); const session = lock.unlock("alice");
  const admission = lock.admission(lock.admit(session.token, "alice"));
  let commits = 0;
  const pane = await dispatchTaskCreation(admission, async () => { lock.lock(session.token, "alice"); return { pane_id: "p1" }; }, async (result, settlement) => {
    expect(settlement.resourceId).toBe(result.pane_id);
    settlement.dispatch(() => commits++);
    expect(() => settlement.dispatch(() => commits++)).toThrow();
    expect(() => admission.dispatch(() => commits++)).toThrow("session.locked");
  });
  expect(pane.pane_id).toBe("p1"); expect(commits).toBe(1);
});
