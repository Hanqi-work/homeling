import type { MutationAdmission } from "./session-lock.ts";
const resultBrand: unique symbol = Symbol("ResultRegistration");
export interface TaskResultAdmission extends MutationAdmission {
  readonly [resultBrand]: true;
  readonly scope: "task.result";
  readonly resourceId: string;
}
/** The trusted caller supplies a fixed ledger registration callback, not a queued user action.
 * Only a successfully dispatched creation can grant one atomic commit for its returned pane.
 * Ledger consumers must compare resourceId to the record's paneId before accepting this capability.
 */
export async function dispatchTaskCreation<T extends { readonly pane_id: string }>(
  admission: MutationAdmission,
  create: () => Promise<T>,
  register: (pane: T, result: TaskResultAdmission) => Promise<void>,
): Promise<T> {
  const pane = await admission.dispatch(create);
  let committed = false;
  const result: TaskResultAdmission = Object.freeze({
    [resultBrand]: true as const, scope: "task.result" as const, resourceId: pane.pane_id,
    assert() { if (committed) throw new Error("task result already registered"); },
    dispatch<R>(effect: () => R): R {
      this.assert(); committed = true; return effect();
    },
  });
  await register(pane, result);
  return pane;
}
