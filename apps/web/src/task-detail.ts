import type { TaskStatus } from "@homeling/contracts";
import { createDeferredSendQueue, enqueueUnlessConfirmed, type DeferredSendQueue, type SendOperation } from "./send-queue.ts";

export type TaskAvailability = "checking" | "active" | "finished" | "unavailable";

export function taskRuntimeMinutes(startedAt: number, now: number, terminalAt?: number): number {
  const endAt = terminalAt ?? now;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endAt)) return 0;
  return Math.max(0, Math.floor((endAt - startedAt) / 60_000));
}

export function taskAvailability(
  status: TaskStatus | undefined,
  panePresent: boolean,
  snapshotLoaded: boolean,
): TaskAvailability {
  if (status === "done") return "finished";
  if (!panePresent) return snapshotLoaded ? "unavailable" : "checking";
  return "active";
}

export function taskCanBeInterrupted(
  status: TaskStatus | undefined,
  panePresent: boolean,
  snapshotLoaded: boolean,
  hintStatus?: TaskStatus,
): boolean {
  const availability = taskAvailability(status ?? hintStatus, panePresent, snapshotLoaded);
  if (availability === "active") return status !== "unknown";
  return availability === "checking" && hintStatus !== undefined && hintStatus !== "done" && hintStatus !== "unknown";
}

/** A prior stop acknowledgement never hides a stop action while snapshot still says active. */
export function stopControlState(
  status: TaskStatus | undefined,
  panePresent: boolean,
  snapshotLoaded: boolean,
  acknowledged: boolean,
  hintStatus?: TaskStatus,
): { readonly canStop: boolean; readonly stillActiveAfterInterrupt: boolean } {
  const availability = taskAvailability(status ?? hintStatus, panePresent, snapshotLoaded);
  const canStop = taskCanBeInterrupted(status, panePresent, snapshotLoaded, hintStatus);
  return { canStop, stillActiveAfterInterrupt: acknowledged && canStop && availability === "active" };
}

export interface TaskSendQueue extends DeferredSendQueue {
  isBlocked(): boolean;
  isBlockedFor(id: string): boolean;
}

export function createTaskSendQueue(): TaskSendQueue {
  const queue = createDeferredSendQueue();
  let blockedId: string | null = null;
  return {
    enqueue: (id, operation) => queue.enqueue(id, operation),
    block(id) {
      blockedId = id;
      queue.block(id);
    },
    unblock(id) {
      if (blockedId !== id) return;
      blockedId = null;
      queue.unblock(id);
    },
    isBlocked: () => blockedId !== null,
    isBlockedFor: (id) => blockedId === id,
  };
}

export function enqueueTaskSend(
  queue: TaskSendQueue,
  id: string,
  isConfirmed: () => boolean,
  operation: SendOperation,
): Promise<void> {
  return enqueueUnlessConfirmed(queue, id, isConfirmed, operation);
}
