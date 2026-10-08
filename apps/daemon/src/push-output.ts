import { createHash } from 'node:crypto';
import type { PushPayload } from '@homeling/contracts';
import { withRetractTags, type PushPersistence, type StoredPushSubscription } from './push-store.ts';
import type { SystemAdmission } from './system-admission.ts';
import { SessionLocked, type MutationAdmission } from './session-lock.ts';

export type PushSendResult = { readonly status: 'sent' | 'invalid' | 'failed'; readonly statusCode?: number };
export interface PushTransport { send(subscription: StoredPushSubscription, payload: PushPayload): Promise<PushSendResult> }
export interface PushClock { now(): number }
export interface PushDeliveryReport { readonly sent: number; readonly invalid: number; readonly failed: number; readonly suppressed: number }
export interface PushOutput { send(payload: PushPayload): Promise<PushDeliveryReport>; retract(tag: string): Promise<void> }
export function createPushOutput(options: {
  store: PushPersistence;
  transport: PushTransport;
  clock: PushClock;
  admission: SystemAdmission<'push.deliver'>;
  cleanupAdmission: SystemAdmission<'push.cleanup'>;
}): PushOutput {
  if (options.admission.scope !== 'push.deliver' || options.cleanupAdmission.scope !== 'push.cleanup') throw new Error('push output requires exact daemon capabilities');
  const cancelled = new Set<string>();
  let tail: Promise<unknown> = Promise.resolve();
  const removeInvalid = async (endpoint: string) => {
    await options.store.mutate(state => ({ next: { ...state, subscriptions: state.subscriptions.filter(s => s.endpoint !== endpoint) }, result: undefined }), options.cleanupAdmission);
  };
  return {
    send(payload) {
      const operation = tail.then(async () => {
        const report = { sent: 0, invalid: 0, failed: 0, suppressed: 0 };
        const state = await options.store.load();
        if (!state.preferences.enabled || state.retractTags.includes(payload.tag) || cancelled.has(payload.tag)) return { ...report, suppressed: state.subscriptions.length };
        const invalidEndpoints: string[] = [];
        for (const subscription of state.subscriptions) {
          if (cancelled.has(payload.tag)) { report.suppressed++; continue; }
          const key = createHash('sha256').update(payload.occurrenceKey).update('\0').update(subscription.endpoint).digest('hex');
          if (state.deliveries[key] !== undefined) { report.suppressed++; continue; }
          const claimed = await options.store.mutate(current => {
            if (!current.preferences.enabled || current.retractTags.includes(payload.tag) || cancelled.has(payload.tag) || current.deliveries[key] !== undefined || !current.subscriptions.some(s => s.endpoint === subscription.endpoint)) return { next: current, result: false };
            return { next: { ...current, deliveries: { ...current.deliveries, [key]: options.clock.now() } }, result: true };
          }, options.admission);
          if (!claimed || cancelled.has(payload.tag)) { report.suppressed++; continue; }
          // Claim is already durable. Register dispatch synchronously against current cancellation
          // state in the same store queue as resolution, but don't hold that queue over network I/O.
          const dispatched = await options.store.mutate(current => {
            if (!current.preferences.enabled || current.retractTags.includes(payload.tag) || cancelled.has(payload.tag) || !current.subscriptions.some(s => s.endpoint === subscription.endpoint)) return { next: current, result: null };
            let delivery: Promise<PushSendResult>;
            try { delivery = options.admission.dispatch(() => options.transport.send(subscription, payload)); }
            catch { delivery = Promise.resolve({ status: 'failed' }); }
            return { next: current, result: { delivery: delivery.catch((): PushSendResult => ({ status: 'failed' })) } };
          }, options.admission);
          if (!dispatched) { report.suppressed++; continue; }
          const result = await dispatched.delivery;
          report[result.status]++;
          if (result.status === 'invalid') invalidEndpoints.push(subscription.endpoint);
        }
        // Cleanup is admitted and errors remain observable, but never precedes healthy deliveries.
        await Promise.all(invalidEndpoints.map(removeInvalid));
        return report;
      });
      tail = operation.catch(() => undefined);
      return operation;
    },
    async retract(tag) {
      cancelled.add(tag);
      await options.store.mutate(state => ({ next: withRetractTags(state, [tag]), result: undefined }), options.admission);
      // Cancellation is guaranteed only before dispatch. No silent retract-only Web Push:
      // userVisibleOnly requires a visible notification; local SW messages can attempt closure.
    },
  };
}
/** User test sends retain their original admission; never route through system output. */
export async function sendPushTest(store: PushPersistence, transport: PushTransport, endpoint: string, owner: string, admission: MutationAdmission): Promise<PushSendResult> {
  if ('scope' in admission) throw new SessionLocked();
  admission.assert();
  const subscription = (await store.load()).subscriptions.find(s => s.endpoint === endpoint && s.owner === owner);
  if (!subscription) throw new Error('subscription not found');
  return admission.dispatch(() => transport.send(subscription, { version: 1, type: 'notification', title: 'Homeling', body: '通知已连接。真实审批会在这里显示具体问题。', bodyTemplate: { key: 'push.test', params: {} }, tag: 'homeling-test', url: '/lite/settings', occurrenceKey: 'test' }));
}
