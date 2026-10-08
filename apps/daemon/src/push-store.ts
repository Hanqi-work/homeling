import { mkdir, readFile, rename, writeFile, rm, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MutationAdmission } from './session-lock.ts';

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
}
export const emptyPushState = (): PushState => ({ version: 1, subscriptions: [], preferences: { enabled: true }, deliveries: {}, pendingOccurrences: {}, activityCursor: 0 });
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
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('unsafe push store permissions');
      const state = JSON.parse(await readFile(this.path, 'utf8')) as PushState;
      if (state.version !== 1 || !Array.isArray(state.subscriptions) || typeof state.preferences?.enabled !== 'boolean' || !state.deliveries || typeof state.deliveries !== 'object') throw new Error('invalid push store');
      this.current = state;
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
      const changed = change(structuredClone(await this.read()));
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
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
