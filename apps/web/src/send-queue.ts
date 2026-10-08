export type SendOperation = () => Promise<void>;

export interface DeferredSendQueue {
  enqueue(id: string, operation: SendOperation): Promise<void>;
  block(id: string): void;
  unblock(id: string): void;
}

/** Serialize terminal input operations and hold later messages behind unresolved pane input. */
export function createDeferredSendQueue(): DeferredSendQueue {
  let tail: Promise<void> = Promise.resolve();
  let blockedId: string | null = null;
  const deferred: Array<{ id: string; operation: SendOperation }> = [];

  function enqueue(id: string, operation: SendOperation): Promise<void> {
    const result = tail.then(async () => {
      if (blockedId !== null && id !== blockedId) {
        deferred.push({ id, operation });
        return;
      }
      await operation();
    });
    tail = result.catch(() => {});
    return result;
  }

  function unblock(id: string): void {
    if (blockedId !== id) return;
    blockedId = null;
    for (const item of deferred.splice(0)) enqueue(item.id, item.operation);
  }

  return {
    enqueue,
    block(id) { blockedId = id; },
    unblock,
  };
}

/** Recheck observable history when dequeued, not when the retry button was clicked. */
export function enqueueUnlessConfirmed(
  queue: DeferredSendQueue,
  id: string,
  isConfirmed: () => boolean,
  operation: SendOperation,
): Promise<void> {
  return queue.enqueue(id, async () => {
    if (!isConfirmed()) await operation();
  });
}
