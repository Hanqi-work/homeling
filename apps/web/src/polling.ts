type Schedule = (callback: () => void, delayMs: number) => number;
type Cancel = (timerId: number) => void;

/** Run one poll at a time; the delay starts after the prior request settles. */
export function startSerialPolling(
  poll: () => Promise<void>,
  delayMs: number,
  schedule: Schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel: Cancel = (timerId) => window.clearTimeout(timerId),
): () => void {
  let timerId: number | null = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    timerId = schedule(() => {
      timerId = null;
      run();
    }, delayMs);
  };
  const run = () => {
    if (stopped) return;
    void Promise.resolve().then(() => stopped ? undefined : poll()).then(scheduleNext, scheduleNext);
  };

  run();
  return () => {
    stopped = true;
    if (timerId !== null) cancel(timerId);
    timerId = null;
  };
}

export interface AbortablePollingSession {
  readonly controller: AbortController;
  stop(): void;
}

/** Own one pane's poll timer and request lifetime as a single disposable session. */
export function startAbortableSerialPolling(
  poll: (signal: AbortSignal) => Promise<void>,
  delayMs: number,
  schedule?: Schedule,
  cancel?: Cancel,
): AbortablePollingSession {
  const controller = new AbortController();
  const stopPolling = startSerialPolling(() => poll(controller.signal), delayMs, schedule, cancel);
  return {
    controller,
    stop() {
      controller.abort();
      stopPolling();
    },
  };
}
