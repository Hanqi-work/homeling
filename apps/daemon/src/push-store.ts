import { rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MutationAdmission } from './session-lock.ts';
import { ensurePushPrivateDirectory, readPushPrivateJson } from './push-private-files.ts';

export interface StoredPushSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly owner: string;
}
export interface PendingPushOccurrence {
  readonly binding: string;
  readonly identity: string;
  readonly occurrenceKey: string;
  readonly active: boolean;
}
export interface PushState {
  readonly version: 1;
  readonly subscriptions: readonly StoredPushSubscription[];
  readonly preferences: { readonly enabled: boolean };
  /** Claims are persisted before dispatch: uncertain in-flight sends are not replayed. */
  readonly deliveries: Readonly<Record<string, number>>;
  readonly pendingOccurrences: Readonly<Record<string, PendingPushOccurrence>>;
  readonly activityCursor: number;
  /** Notification-only tombstones; retained through occurrence replacement and daemon restart. */
  readonly retractTags: readonly string[];
}
export const emptyPushState = (): PushState => ({ version: 1, subscriptions: [], preferences: { enabled: true }, deliveries: {}, pendingOccurrences: {}, activityCursor: 0, retractTags: [] });
export function withRetractTags(state: PushState, tags: readonly string[]): PushState {
  if (tags.every(tag => state.retractTags.includes(tag))) return state;
  return { ...state, retractTags: [...new Set([...state.retractTags, ...tags])] };
}
export interface PushPersistence {
  load(): Promise<PushState>;
  mutate<T>(change: (state: PushState) => { next: PushState; result: T }, admission: MutationAdmission): Promise<T>;
}
export class PushStore implements PushPersistence {
  private tail: Promise<void> = Promise.resolve();
  private current: PushState | undefined;
  constructor(readonly path: string) {}
  async load(): Promise<PushState> {
    await this.tail;
    return structuredClone(await this.read());
  }
  private async read(): Promise<PushState> {
    if (this.current) return this.current;
    try {
      const state = await readPushPrivateJson<PushState>(this.path, 16_000_000);
      if (state.version !== 1 || !Array.isArray(state.subscriptions) || typeof state.preferences?.enabled !== 'boolean' || !state.deliveries || typeof state.deliveries !== 'object' || !state.pendingOccurrences || typeof state.pendingOccurrences !== 'object' || !Number.isSafeInteger(state.activityCursor) || state.activityCursor < 0) throw new Error('invalid push store');
      if (Object.values(state.deliveries).some(time => !Number.isFinite(time)) || Object.values(state.pendingOccurrences).some(item => !item || typeof item.binding !== 'string' || typeof item.identity !== 'string' || typeof item.occurrenceKey !== 'string' || typeof item.active !== 'boolean')) throw new Error('invalid push occurrence state');
      if (state.subscriptions.some(item => !item || typeof item.owner !== 'string' || typeof item.endpoint !== 'string' || typeof item.keys?.p256dh !== 'string' || typeof item.keys.auth !== 'string')) throw new Error('invalid push subscription state');
      const retractTags = state.retractTags ?? [];
      if (!Array.isArray(retractTags) || retractTags.some(tag => typeof tag !== 'string')) throw new Error('invalid push retract state');
      // Read-only compatibility for older v1 files; only a later admitted mutation persists the field.
      this.current = { ...state, retractTags };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.current = emptyPushState();
    }
    return this.current;
  }
  mutate<T>(change: (state: PushState) => { next: PushState; result: T }, admission: MutationAdmission): Promise<T> {
    admission.assert();
    const operation = this.tail.then(async () => {
      admission.assert();
      const state = structuredClone(await this.read());
      const changed = change(state);
      if (changed.next === state) return changed.result;
      await ensurePushPrivateDirectory(dirname(this.path));
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(changed.next), { mode: 0o600, flag: 'wx' });
        await admission.dispatch(() => rename(temporary, this.path));
        this.current = structuredClone(changed.next);
        return changed.result;
      } finally { await rm(temporary, { force: true }); }
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
