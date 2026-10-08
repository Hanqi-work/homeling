import { join } from 'node:path';
import type { DaemonConfig } from './config.ts';
import type { PersonaRuntime } from './persona-service.ts';
import type { createDaemonSystemAdmissions } from './system-admission.ts';
import { PushStore } from './push-store.ts';
import { createWebPushTransport, loadOrCreateVapid } from './push-transport.ts';
import { createPushOutput } from './push-output.ts';
import { PushEventConsumer } from './push-events.ts';
import { readPendingPushObservations } from './push-source.ts';
import type { PushApiRuntime } from './push-api.ts';

export interface PushDaemonRuntime extends PushApiRuntime { stop(): void }
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
  let polling = false;
  const drain = () => { if (!stopped) void consumer.drainActivity().catch(() => console.error('[homeling-daemon] trusted push activity unavailable')); };
  const unsubscribe = persona.activity.subscribe(drain);
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const observations = await readPendingPushObservations(cfg, persona.fetcher, persona.registry, paneId => persona.activity!.ownership(paneId));
      if (!stopped) await consumer.observePending(observations);
    } catch { console.error('[homeling-daemon] push observation gap; retaining pending identities'); }
    finally { polling = false; }
  };
  // Read the durable ledger as well as subscribe: a commit during startup cannot fall between them.
  drain();
  void poll();
  const timer = setInterval(() => { void poll(); }, 2500);
  timer.unref?.();
  return { publicKey: keys.publicKey, store, transport, stop() { stopped = true; clearInterval(timer); unsubscribe(); } };
}
