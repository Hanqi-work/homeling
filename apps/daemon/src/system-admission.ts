import type { MutationAdmission } from "./session-lock.ts";

const systemBrand: unique symbol = Symbol("DaemonSystemAdmission");
export type SystemScope = "persona.recovery" | "activity.observe" | "push.deliver" | "push.cleanup";
export interface SystemAdmission<S extends SystemScope> extends MutationAdmission {
  readonly [systemBrand]: true;
  readonly scope: S;
}
function scoped<S extends SystemScope>(scope: S): SystemAdmission<S> {
  return Object.freeze({ [systemBrand]: true as const, scope, assert() {}, dispatch<T>(effect: () => T): T { return effect(); } });
}
/** Only the trusted daemon bootstrap calls this factory, never request handlers or user queues.
 * Consumers require their literal scope: observation can append known-task events, recovery can
 * maintain persisted personas, delivery can send configured notifications, cleanup can remove
 * invalid subscriptions/cursors. No scope grants delegated user controls or enrollment.
 */
export function createDaemonSystemAdmissions() {
  return Object.freeze({
    personaRecovery: scoped("persona.recovery"),
    activityObserve: scoped("activity.observe"),
    pushDeliver: scoped("push.deliver"),
    pushCleanup: scoped("push.cleanup"),
  });
}
