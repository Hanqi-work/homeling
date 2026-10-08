import { normalizeHerdrActivityEvent, type ActivityLedger } from "./activity-ledger.ts";
import type { HerdrPort } from "./herdr-client.ts";
import type { SystemAdmission } from "./system-admission.ts";

/** Snapshots scope subscriptions, never supply history. Recovery must persist a gap before live. */
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
  let pendingGap: { reason: string } | undefined = { reason: "Daemon observer restarted; Herdr does not expose event replay" };
  let gapRecorded = false;
  let cancelCandidate: (() => void) | undefined;
  const report = (error: unknown) => console.error("[homeling-daemon] activity observation unavailable", error);
  const persistGap = async () => {
    const gap = pendingGap;
    if (!gap) return;
    await ledger.gap(gap.reason, admission);
    if (pendingGap === gap) { pendingGap = undefined; gapRecorded = true; }
  };
  const invalidate = (reason: string) => {
    if (activeGeneration !== 0 || !gapRecorded) pendingGap ??= { reason };
    activeGeneration = 0;
    ledger.degrade(admission);
    stream?.close();
  };
  const retry = () => {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = undefined; void connect().catch(report); }, options.retryMs ?? 2_000);
  };
  const enqueue = (operation: () => Promise<void>) => {
    const current = eventTail.then(operation);
    eventTail = current.catch(async (error) => {
      report(error);
      invalidate("Herdr event validation/persistence failed; observation continuity is unknown");
      try { await persistGap(); } catch (gapError) { report(gapError); }
      retry();
    });
    return eventTail;
  };
  const connect = (requiredPane?: string): Promise<void> => {
    const attempt = connectionTail.catch(() => undefined).then(async () => {
      if (closed) throw new Error("Activity observer closed");
      await eventTail;
      await persistGap();
      const [history, snapshot] = await Promise.all([ledger.list(), herdr.snapshot()]);
      const existing = new Set(snapshot.panes.map((pane) => pane.pane_id));
      const paneIds = [...new Set(history.occurrences.map((item) => item.paneId))].filter((id) => existing.has(id));
      if (requiredPane && !paneIds.includes(requiredPane)) throw new Error("Task pane unavailable before observation starts");
      const candidateGeneration = ++generation;
      await new Promise<void>((resolve, reject) => {
        let candidate: { close(): void } | undefined;
        cancelCandidate = () => { candidate?.close(); reject(new Error("Activity observer closed")); };
        candidate = herdr.subscribe((event, data) => {
          if (closed || activeGeneration !== candidateGeneration) return;
          void enqueue(async () => {
            if (closed || activeGeneration !== candidateGeneration) return;
            const name = event.replaceAll(".", "_");
            if (["pane_agent_status_changed", "pane_exited", "pane_closed"].includes(name) && !normalizeHerdrActivityEvent(event, data)) throw new Error("Unsupported Herdr activity event payload");
            await ledger.observe(event, data, admission);
          });
        }, (reason) => {
          candidate?.close();
          if (!closed && (activeGeneration === candidateGeneration || activeGeneration === 0)) {
            invalidate(reason);
            void enqueue(persistGap);
            retry();
          }
          reject(new Error(reason));
        }, { paneIds, onUp: () => {
          if (closed || pendingGap) { candidate?.close(); reject(new Error("Observation gap has not been persisted")); return; }
          const previous = stream;
          stream = candidate;
          activeGeneration = candidateGeneration;
          gapRecorded = false;
          ledger.live(admission);
          previous?.close();
          resolve();
        } });
      }).finally(() => { cancelCandidate = undefined; });
    });
    connectionTail = attempt;
    void attempt.catch((error) => {
      if (!closed && activeGeneration === 0) { ledger.degrade(admission); retry(); }
      report(error);
    });
    return attempt;
  };
  ledger.degrade(admission);
  const ready = connect();
  return {
    ready,
    async watch(paneId) { await ready.catch(() => undefined); await connect(paneId); },
    async flush() { await eventTail; },
    close() { closed = true; clearTimeout(timer); cancelCandidate?.(); stream?.close(); },
  };
}
