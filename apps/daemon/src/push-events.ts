import type { ActivityResponse } from '@homeling/contracts';
import type { PushOutput } from './push-output.ts';
import type { PushPersistence } from './push-store.ts';
import { PendingPushLedger, type PendingPushObservation } from './push-pending.ts';
import type { SystemAdmission } from './system-admission.ts';

export interface PushActivityInput { list(personaId?: string, afterSequence?: number): Promise<ActivityResponse> }
export class PushEventConsumer {
  private readonly pending: PendingPushLedger;
  private activityTail: Promise<void> = Promise.resolve();
  constructor(private readonly options: { store: PushPersistence; activity: PushActivityInput; registry: { get(id: string): Promise<{ name: string } | undefined> }; output: PushOutput; admission: SystemAdmission<'push.deliver'> }) {
    this.pending = new PendingPushLedger(options.store, options.admission);
  }
  async retainBindings(valid: ReadonlySet<string>): Promise<void> {
    for (const event of await this.pending.retainBindings(valid)) await this.options.output.retract(event.tag);
  }
  async observePending(observations: readonly PendingPushObservation[]): Promise<void> {
    for (const observation of observations) {
      const event = await this.pending.observe(observation);
      if (event?.supersededTag) await this.options.output.retract(event.supersededTag);
      if (event?.state === 'resolved') await this.options.output.retract(event.tag);
      if (event?.payload) {
        // Don't block the next resolution observation on a slow push service.
        void this.options.output.send(event.payload).catch(() => console.error('[homeling-daemon] push delivery persistence failed'));
      }
    }
  }
  drainActivity(): Promise<void> {
    const operation = this.activityTail.then(async () => {
      const cursor = (await this.options.store.load()).activityCursor;
      const response = await this.options.activity.list(undefined, cursor);
      const occurrences = new Map(response.occurrences.map(item => [item.occurrenceKey, item]));
      for (const event of response.events) {
        if (event.kind === 'task.completed' || event.kind === 'task.failed') {
          const occurrence = occurrences.get(event.occurrenceKey);
          const persona = await this.options.registry.get(event.personaId);
          if (occurrence && occurrence.personaId === event.personaId && occurrence.paneId === event.paneId && persona) {
            await this.options.output.send({ version: 1, type: 'notification', title: persona.name, body: `${event.kind === 'task.completed' ? '任务完成' : '任务失败'}：${occurrence.title}${event.detail ? ` · ${event.detail}` : ''}`.slice(0, 500), tag: `homeling-task-${event.occurrenceKey}`, url: `/lite/t/${encodeURIComponent(event.paneId)}?occurrence=${encodeURIComponent(event.occurrenceKey)}`, occurrenceKey: event.dedupeKey });
          }
        }
        await this.options.store.mutate(state => ({ next: { ...state, activityCursor: Math.max(state.activityCursor, event.sequence) }, result: undefined }), this.options.admission);
      }
    });
    this.activityTail = operation.catch(() => undefined);
    return operation;
  }
}
