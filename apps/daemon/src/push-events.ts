import type { ActivityResponse } from '@homeling/contracts';
import type { PushClock, PushOutput } from './push-output.ts';
import type { PushPersistence } from './push-store.ts';
import type { PendingPushObservation } from './push-pending.ts';
import { PushCoordinator } from './push-coordinator.ts';
import type { SystemAdmission } from './system-admission.ts';

export interface PushActivityInput { list(personaId?: string, afterSequence?: number): Promise<ActivityResponse> }
export class PushEventConsumer {
  private readonly coordinator: PushCoordinator;
  private activityTail: Promise<void> = Promise.resolve();
  constructor(private readonly options: { store: PushPersistence; activity: PushActivityInput; registry: { get(id: string): Promise<{ name: string } | undefined> }; output: PushOutput; admission: SystemAdmission<'push.deliver'>; clock?: PushClock; debounceMs?: number }) {
    this.coordinator = new PushCoordinator({ ...options, clock: options.clock ?? { now: Date.now } });
  }
  retainBindings(valid: ReadonlySet<string>): Promise<void> { return this.coordinator.retainBindings(valid); }
  observePending(observations: readonly PendingPushObservation[]): Promise<void> { return this.coordinator.observePending(observations); }
  flushPending(): ReturnType<PushCoordinator['flush']> { return this.coordinator.flush(); }
  stop(): void { this.coordinator.stop(); }
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
            await this.options.output.send({ version: 1, type: 'notification', title: persona.name, body: `${event.kind === 'task.completed' ? '任务完成' : '任务失败'}：${occurrence.title}${event.detail ? ` · ${event.detail}` : ''}`.slice(0, 500), bodyTemplate: { key: event.kind === 'task.completed' ? 'push.taskCompleted' : 'push.taskFailed', params: { taskTitle: occurrence.title, detail: event.detail ?? '' } }, tag: `homeling-task-${event.occurrenceKey}`, url: `/lite/t/${encodeURIComponent(event.paneId)}?occurrence=${encodeURIComponent(event.occurrenceKey)}`, occurrenceKey: event.dedupeKey });
          }
        }
        await this.options.store.mutate(state => ({ next: { ...state, activityCursor: Math.max(state.activityCursor, event.sequence) }, result: undefined }), this.options.admission);
      }
    });
    this.activityTail = operation.catch(() => undefined);
    return operation;
  }
}
