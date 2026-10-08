import { expect, test } from "bun:test";
import { SessionStateStore } from "./session-state.ts";
test("an unknown session is read-only and unlock requires read catch-up before admission", () => {
  const session = new SessionStateStore();
  expect(() => session.admit()).toThrow("session.locked");
  session.apply({ locked: false, epoch: 1, generation: "boot1" });
  expect(() => session.admit()).toThrow("session.locked");
  session.caughtUp();
  const check = session.admit(); check();
  session.lock();
  session.apply({ locked: false, epoch: 2, generation: "boot1" }); session.caughtUp();
  expect(() => check()).toThrow("session.locked");
  session.admit()();
});
