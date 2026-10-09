import { createHash } from 'node:crypto';
import type { PushPayload } from '@homeling/contracts';
import type { PushClock, PushDeliveryReport, PushOutput } from './push-output.ts';
import { PendingPushLedger, type PendingPushObservation } from './push-pending.ts';
import { withRetractTags, type PushPersistence } from './push-store.ts';
import type { SystemAdmission } from './system-admission.ts';

interface QueuedRequest { payload: PushPayload; personaId: string; due: number; windowClose: number }
/** Consumes trusted observations; unknown screens neither create new requests nor settle old ones. */
export class PushCoordinator {
  private readonly ledger: PendingPushLedger;
  private readonly queue = new Map<string, QueuedRequest>();
  private stopped = false;
  constructor(private readonly options: { store: PushPersistence; output: PushOutput; clock: PushClock; admission: SystemAdmission<'push.deliver'>; debounceMs?: number }) {
    this.ledger = new PendingPushLedger(options.store, options.admission);
  }
  async observePending(observations: readonly PendingPushObservation[]): Promise<void> {
    for (const observation of observations) {
      if (this.stopped || observation.state === 'unknown') continue;
      const state = await this.options.store.load();
      const previous = Object.values(state.pendingOccurrences).find(item => item.binding === observation.binding);
      const event = await this.ledger.observe(observation);
      // Once retirement committed, even a later baseline write failure must not strand a queue slot.
      if (event?.supersededTag) this.queue.delete(event.supersededTag);
      if (event?.state === 'resolved') this.queue.delete(event.tag);
      if (observation.state === 'resolved') {
        await this.options.store.mutate(current => {
          const handled = current.coordination?.handled ?? {};
          const baselines = [...new Set([...(current.coordination?.baselines ?? []), observation.binding])];
          return { next: { ...current, coordination: { handled, baselines } }, result: undefined };
        }, this.options.admission);
      }
      if (event?.supersededTag) await this.retract(event.supersededTag);
      if (event?.state === 'resolved') await this.retract(event.tag);
      if (observation.state !== 'pending' || !event?.payload) continue;
      const payload = event.payload;
      if (this.queue.has(payload.tag)) continue;
      const handled = (await this.options.store.load()).coordination?.handled ?? {};
      if (Object.hasOwn(handled, payload.occurrenceKey)) continue;
      const newIdentity = previous?.active === true && previous.identity !== createHash('sha256').update(observation.identity).digest('hex');
      const fresh = newIdentity || (previous?.active !== true && state.coordination?.baselines.includes(observation.binding));
      if (!fresh || !observation.personaId) {
        await this.options.store.mutate(current => {
          const baselines = current.coordination?.baselines ?? [];
          const handled = { ...current.coordination?.handled, [payload.occurrenceKey]: null };
          return { next: { ...current, coordination: { baselines, handled } }, result: undefined };
        }, this.options.admission);
        continue;
      }
      const now = this.options.clock.now();
      const due = now + (this.options.debounceMs ?? 3000);
      const openWindow = Math.min(...[...this.queue.values()].filter(item => item.windowClose >= now).map(item => item.windowClose));
      this.queue.set(payload.tag, { payload, personaId: observation.personaId, due, windowClose: Number.isFinite(openWindow) ? openWindow : due });
    }
  }
  async retainBindings(valid: ReadonlySet<string>): Promise<void> {
    for (const event of await this.ledger.retainBindings(valid)) await this.retract(event.tag);
  }
  private async retract(tag: string): Promise<void> {
    this.queue.delete(tag);
    const aggregateTag = await this.options.store.mutate(state => {
      const key = tag.startsWith('homeling-request-') ? `request:${tag.slice('homeling-request-'.length)}` : '';
      const aggregate = state.coordination?.handled[key];
      return { next: aggregate ? withRetractTags(state, [aggregate]) : state, result: aggregate };
    }, this.options.admission);
    await this.options.output.retract(tag);
    if (aggregateTag && aggregateTag !== tag) await this.options.output.retract(aggregateTag);
  }
  async flush(): Promise<PushDeliveryReport | undefined> {
    if (this.stopped) return;
    const windowClose = Math.min(...[...this.queue.values()].map(item => item.windowClose));
    const ready = [...this.queue.values()].filter(item => item.windowClose === windowClose);
    // Fixed admission window coalesces staggered arrivals; each member still gets a full debounce.
    if (!ready.length || ready.some(item => item.due > this.options.clock.now())) return;
    let payload = ready[0]!.payload;
    if (ready.length > 1) {
      const count = new Set(ready.map(item => item.personaId)).size;
      const digest = createHash('sha256').update(JSON.stringify(ready.map(item => item.payload.occurrenceKey).sort())).digest('hex');
      payload = {
        version: 1, type: 'notification', title: `${count} 个伙伴需要你`,
        body: ready.map(item => `${item.payload.title}: ${item.payload.body}`).join('\n').slice(0, 500),
        titleTemplate: { key: 'push.agentsNeedYou', params: { count } },
        summaryTemplate: { key: 'push.agentsSummary', params: { count }, questions: ready.map(item => ({ personaName: item.payload.title, question: item.payload.bodyTemplate?.params.question ?? item.payload.body })) },
        tag: `homeling-needs-you-${digest}`, url: '/lite/', occurrenceKey: `coalesce:${digest}`,
      };
    }
    const claimed = await this.options.store.mutate(state => {
      const handled = { ...state.coordination?.handled };
      if (this.stopped || ready.some(item => !this.queue.has(item.payload.tag) || state.retractTags.includes(item.payload.tag) || Object.hasOwn(handled, item.payload.occurrenceKey))) return { next: state, result: false };
      for (const item of ready) handled[item.payload.occurrenceKey] = payload.tag;
      return { next: { ...state, coordination: { baselines: state.coordination?.baselines ?? [], handled } }, result: true };
    }, this.options.admission);
    // Registration follows the last synchronous cancellation check. Resolution needn't await send.
    if (!claimed || this.stopped || ready.some(item => !this.queue.has(item.payload.tag))) return;
    for (const item of ready) this.queue.delete(item.payload.tag);
    return this.options.output.send(payload);
  }
  stop(): void { this.stopped = true; this.queue.clear(); }
}
