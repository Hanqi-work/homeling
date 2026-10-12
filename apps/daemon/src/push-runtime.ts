import { join } from 'node:path';
import type { DaemonConfig } from './config.ts';
import type { PersonaRuntime } from './persona-service.ts';
import type { createDaemonSystemAdmissions } from './system-admission.ts';
import { PushStore } from './push-store.ts';
import { createWebPushTransport, loadOrCreateVapid } from './push-transport.ts';
import { createPushOutput } from './push-output.ts';
import { PushEventConsumer } from './push-events.ts';
import { readPendingPushBatch, type PendingPushBatch } from './push-source.ts';
import type { PushApiRuntime } from './push-api.ts';

export interface PushDaemonRuntime extends PushApiRuntime { stop(): void }
/** Public polling seam: its source is read-only, while delivery never blocks reconciliation. */
export function createPushPolling(consumer: PushEventConsumer, readBatch: () => Promise<PendingPushBatch>): { poll(): Promise<void>; stop(): void } {
  let stopped = false;
  let polling = false;
  return {
    async poll() {
      if (stopped || polling) return;
      polling = true;
      try {
        const batch = await readBatch();
        if (stopped) return;
        await consumer.retainBindings(batch.validBindings);
        await consumer.observePending(batch.observations);
        if (!stopped) void consumer.flushPending().then(report => {
          if (report?.failed) console.error(`[homeling-daemon] push delivery failed for ${report.failed} subscription(s); uncertain claims will not be replayed`);
        }).catch(() => console.error('[homeling-daemon] push coordination persistence failed'));
      } catch { console.error('[homeling-daemon] push observation gap; retaining pending identities'); }
      finally { polling = false; }
    },
    stop() { stopped = true; consumer.stop(); },
  };
}
/** Trusted daemon startup only: never called by HTTP handlers or a delegated user queue. */
export async function initializePushRuntime(cfg: DaemonConfig, persona: PersonaRuntime, caps: ReturnType<typeof createDaemonSystemAdmissions>): Promise<PushDaemonRuntime | null> {
  if (!cfg.pushSubject || !cfg.pushDataDir || !persona.activity) return null;
  const keys = await loadOrCreateVapid(join(cfg.pushDataDir, 'vapid.json'));
  const store = new PushStore(join(cfg.pushDataDir, 'push.json'));
  await store.load();
  const transport = createWebPushTransport(keys, cfg.pushSubject);
  const output = createPushOutput({ store, transport, clock: { now: Date.now }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup });
  const consumer = new PushEventConsumer({ store, activity: persona.activity, registry: persona.registry, output, admission: caps.pushDeliver });
  let stopped = false;
  const polling = createPushPolling(consumer, () => readPendingPushBatch(cfg, persona.fetcher, persona.registry, async () => (await persona.activity!.list()).occurrences));
  const drain = () => { if (!stopped) void consumer.drainActivity().catch(() => console.error('[homeling-daemon] trusted push activity unavailable')); };
  const unsubscribe = persona.activity.subscribe(drain);
  // Read the durable ledger as well as subscribe: a commit during startup cannot fall between them.
  drain();
  void polling.poll();
  const timer = setInterval(() => { void polling.poll(); }, 2500);
  timer.unref?.();
  return { publicKey: keys.publicKey, store, transport, stop() { stopped = true; polling.stop(); clearInterval(timer); unsubscribe(); } };
}
