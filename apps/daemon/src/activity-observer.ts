import type { ActivityLedger } from "./activity-ledger.ts";
import type { HerdrPort } from "./herdr-client.ts";
import type { SystemAdmission } from "./system-admission.ts";

/** Observes only persisted task bindings. Snapshots scope subscriptions, never supply history. */
export function createActivityObserver(
  ledger: ActivityLedger,
  herdr: Pick<HerdrPort, "snapshot" | "subscribe">,
  admission: SystemAdmission<"activity.observe">,
  options: { retryMs?: number } = {},
): { ready: Promise<void>; watch(paneId: string): Promise<void>; flush(): Promise<void>; close(): void } {
  let closed = false;
  let stream: { close(): void } | undefined;
  let generation = 0;
  let activeGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let eventTail: Promise<void> = Promise.resolve();
  let connectionTail: Promise<void> = Promise.resolve();
  const report = (error: unknown) => console.error("[homeling-daemon] activity observation unavailable", error);
  const enqueue = (operation: () => Promise<void>) => {
    const current = eventTail.then(operation);
    eventTail = current;
    void current.catch((error) => { report(error); stream?.close(); });
    return current;
  };
  const reconnect = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void connect().catch(report);
    }, options.retryMs ?? 2_000);
  };
  const connect = (requiredPane?: string): Promise<void> => {
    const attempt = connectionTail.catch(() => undefined).then(async () => {
      if (closed) throw new Error("Activity observer closed");
      await eventTail;
      const [history, snapshot] = await Promise.all([ledger.list(), herdr.snapshot()]);
      const existing = new Set(snapshot.panes.map((pane) => pane.pane_id));
      const paneIds = [...new Set(history.occurrences.map((item) => item.paneId))].filter((id) => existing.has(id));
      if (requiredPane && !paneIds.includes(requiredPane)) throw new Error("Task pane unavailable before observation starts");
      const candidateGeneration = ++generation;
      await new Promise<void>((resolve, reject) => {
        let candidate: { close(): void } | undefined;
        candidate = herdr.subscribe((event, data) => {
          if (closed || activeGeneration !== candidateGeneration) return;
          void enqueue(() => ledger.observe(event, data, admission)).catch(() => undefined);
        }, (reason) => {
          candidate?.close();
          if (closed) { reject(new Error("Activity observer closed")); return; }
          if (activeGeneration === candidateGeneration || activeGeneration === 0) {
            activeGeneration = 0;
            void enqueue(() => ledger.gap(reason, admission)).catch(() => undefined);
            reconnect();
          }
          reject(new Error(reason));
        }, { paneIds, onUp: () => {
          if (closed) { candidate?.close(); reject(new Error("Activity observer closed")); return; }
          const previous = stream;
          stream = candidate;
          activeGeneration = candidateGeneration;
          ledger.live(admission);
          previous?.close();
          resolve();
        } });
      });
    });
    connectionTail = attempt;
    return attempt;
  };
  const ready = enqueue(() => ledger.gap("Daemon observer restarted; Herdr does not expose event replay", admission)).then(() => connect()).catch((error) => { reconnect(); throw error; });
  void ready.catch(report);
  return {
    ready,
    async watch(paneId) { await ready.catch(() => undefined); await connect(paneId); },
    async flush() { await eventTail; },
    close() { closed = true; clearTimeout(timer); stream?.close(); },
  };
}
