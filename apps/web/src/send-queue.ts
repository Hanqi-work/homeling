export type SendOperation = () => Promise<void>;
export interface DeferredSendQueue {
  enqueue(id: string, operation: SendOperation): Promise<void>;
  block(id: string): void;
  unblock(id: string): void;
  suspend(): void;
}
interface QueuedSend { id: string; operation: SendOperation; check: () => void }
/** Each item retains its admission from enqueue through every deferral; unlock never re-admits it. */
export function createDeferredSendQueue(
  admit: () => (() => void) = () => () => {},
  onSuspended: (id: string) => void = () => {},
): DeferredSendQueue {
  let tail: Promise<void> = Promise.resolve();
  let blockedId: string | null = null;
  const deferred: QueuedSend[] = [];
  function schedule(item: QueuedSend): Promise<void> {
    const result = tail.then(async () => {
      try { item.check(); } catch { onSuspended(item.id); return; }
      if (blockedId !== null && item.id !== blockedId) { deferred.push(item); return; }
      await item.operation();
    });
    tail = result.catch(() => {});
    return result;
  }
  function enqueue(id: string, operation: SendOperation): Promise<void> {
    let check: () => void;
    try { check = admit(); } catch (error) { check = () => { throw error; }; }
    return schedule({ id, operation, check });
  }
  function unblock(id: string): void {
    if (blockedId !== id) return;
    blockedId = null;
    for (const item of deferred.splice(0)) void schedule(item).catch(() => {});
  }
  return { enqueue, block(id) { blockedId = id; }, unblock, suspend() { for (const item of deferred.splice(0)) onSuspended(item.id); } };
}
/** Recheck observable history when dequeued, not when the retry button was clicked. */
export function enqueueUnlessConfirmed(queue: DeferredSendQueue, id: string, isConfirmed: () => boolean, operation: SendOperation): Promise<void> {
  return queue.enqueue(id, async () => { if (!isConfirmed()) await operation(); });
}
