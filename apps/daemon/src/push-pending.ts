import { createHash, randomUUID } from 'node:crypto';
import type { PushPayload } from '../../../packages/contracts/src/push.ts';
import type { PushPersistence } from './push-store.ts';
import type { SystemAdmission } from './system-admission.ts';

export interface PendingPushObservation {
  readonly state: 'pending' | 'resolved' | 'unknown';
  /** Registry-created main resource, or #13's durable task lifecycle. Never request.id. */
  readonly binding: string;
  readonly personaId: string;
  readonly personaName: string;
  readonly paneId: string;
  readonly task: boolean;
  readonly identity: string;
  readonly summary: string;
}
export interface PendingPushEvent { readonly state: 'pending' | 'resolved'; readonly tag: string; readonly payload?: PushPayload; readonly supersededTag?: string }
export class PendingPushLedger {
  constructor(private readonly store: PushPersistence, private readonly admission: SystemAdmission<'push.deliver'>) {}
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
        return { next: { ...state, pendingOccurrences: { ...state.pendingOccurrences, [key]: { ...current, active: false } } }, result: { state: 'resolved' as const, tag: `homeling-request-${current.occurrenceKey}` } };
      }
      const identity = createHash('sha256').update(observation.identity).digest('hex');
      const occurrenceKey = current?.active && current.identity === identity ? current.occurrenceKey : randomUUID();
      const tag = `homeling-request-${occurrenceKey}`;
      const payload: PushPayload = { version: 1, type: 'notification', title: observation.personaName.slice(0, 120), body: observation.summary.slice(0, 500), tag, url: observation.task ? `/lite/t/${encodeURIComponent(observation.paneId)}` : `/lite/persona/${encodeURIComponent(observation.personaId)}`, occurrenceKey: `request:${occurrenceKey}` };
      return { next: current?.active && current.identity === identity ? state : { ...state, pendingOccurrences: { ...state.pendingOccurrences, [key]: { binding: observation.binding, identity, occurrenceKey, active: true } } }, result: { state: 'pending' as const, tag, payload, ...(current?.active && current.identity !== identity ? { supersededTag: `homeling-request-${current.occurrenceKey}` } : {}) } };
    }, this.admission);
  }
}
