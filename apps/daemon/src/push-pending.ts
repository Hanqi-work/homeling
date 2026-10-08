import { createHash, randomUUID } from 'node:crypto';
import type { PushPayload } from '../../../packages/contracts/src/push.ts';
import type { PushPersistence } from './push-store.ts';
import type { SystemAdmission } from './system-admission.ts';

/** Binding is opaque to the ledger; the trusted source owns routing and identity. */
export type PendingPushObservation = {
  readonly state: 'pending';
  readonly binding: string;
  readonly personaName: string;
  readonly identity: string;
  readonly summary: string;
  readonly url: string;
} | {
  readonly state: 'resolved';
  readonly binding: string;
} | {
  readonly state: 'unknown';
  readonly binding: string;
};
export interface PendingPushEvent { readonly state: 'pending' | 'resolved'; readonly tag: string; readonly payload?: PushPayload; readonly supersededTag?: string }
export class PendingPushLedger {
  constructor(private readonly store: PushPersistence, private readonly admission: SystemAdmission<'push.deliver'>) {
    if (admission.scope !== 'push.deliver') throw new Error('pending push requires delivery capability');
  }
  /** Only durable registry/ownership replacement or deletion, never snapshot absence, retires a binding. */
  async retainBindings(valid: ReadonlySet<string>): Promise<readonly PendingPushEvent[]> {
    return this.store.mutate(state => {
      const pendingOccurrences = { ...state.pendingOccurrences };
      const events: PendingPushEvent[] = [];
      for (const [key, item] of Object.entries(pendingOccurrences)) {
        if (item.active && !valid.has(item.binding)) {
          pendingOccurrences[key] = { ...item, active: false };
          events.push({ state: 'resolved', tag: `homeling-request-${item.occurrenceKey}` });
        }
      }
      return { next: events.length ? { ...state, pendingOccurrences } : state, result: events };
    }, this.admission);
  }
  async observe(observation: PendingPushObservation): Promise<PendingPushEvent | null> {
    if (observation.state === 'unknown') return null;
    const key = createHash('sha256').update(observation.binding).digest('hex');
    return this.store.mutate<PendingPushEvent | null>(state => {
      const current = state.pendingOccurrences[key];
      if (observation.state === 'resolved') {
        if (!current?.active) return { next: state, result: null };
        const next = {
          ...state,
          pendingOccurrences: { ...state.pendingOccurrences, [key]: { ...current, active: false } },
        };
        const result: PendingPushEvent = { state: 'resolved', tag: `homeling-request-${current.occurrenceKey}` };
        return { next, result };
      }
      const identity = createHash('sha256').update(observation.identity).digest('hex');
      const sameOccurrence = current?.active === true && current.identity === identity;
      const occurrenceKey = sameOccurrence ? current.occurrenceKey : randomUUID();
      const tag = `homeling-request-${occurrenceKey}`;
      const payload: PushPayload = {
        version: 1,
        type: 'notification',
        title: observation.personaName.slice(0, 120),
        body: observation.summary.slice(0, 500),
        tag,
        url: observation.url,
        occurrenceKey: `request:${occurrenceKey}`,
      };
      const next = sameOccurrence ? state : {
        ...state,
        pendingOccurrences: {
          ...state.pendingOccurrences,
          [key]: { binding: observation.binding, identity, occurrenceKey, active: true },
        },
      };
      const supersededTag = current?.active && !sameOccurrence
        ? `homeling-request-${current.occurrenceKey}` : undefined;
      const result: PendingPushEvent = {
        state: 'pending', tag, payload,
        ...(supersededTag ? { supersededTag } : {}),
      };
      return { next, result };
    }, this.admission);
  }
}
