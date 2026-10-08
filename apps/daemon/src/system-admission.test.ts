import { expect, test } from "bun:test";
import { createDaemonSystemAdmissions } from "./system-admission.ts";
test("daemon startup grants only named background capabilities, not an arbitrary system factory", () => {
  const system = createDaemonSystemAdmissions();
  expect(Object.keys(system).sort()).toEqual(["activityObserve", "personaRecovery", "pushCleanup", "pushDeliver"]);
  expect(system.activityObserve.scope).toBe("activity.observe");
  let writes = 0;
  system.activityObserve.dispatch(() => writes++);
  expect(writes).toBe(1);
});
