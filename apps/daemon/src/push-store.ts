import { mkdir, open, rename, writeFile, rm, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
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
      const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let state: PushState;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > 16_000_000) throw new Error('unsafe push store permissions');
        state = JSON.parse(await file.readFile('utf8')) as PushState;
      } finally { await file.close(); }
      if (state.version !== 1 || !Array.isArray(state.subscriptions) || typeof state.preferences?.enabled !== 'boolean' || !state.deliveries || typeof state.deliveries !== 'object' || !state.pendingOccurrences || typeof state.pendingOccurrences !== 'object' || !Number.isSafeInteger(state.activityCursor) || state.activityCursor < 0) throw new Error('invalid push store');
      if (Object.values(state.deliveries).some(time => !Number.isFinite(time)) || Object.values(state.pendingOccurrences).some(item => !item || typeof item.binding !== 'string' || typeof item.identity !== 'string' || typeof item.occurrenceKey !== 'string' || typeof item.active !== 'boolean')) throw new Error('invalid push occurrence state');
      if (state.subscriptions.some(item => !item || typeof item.owner !== 'string' || typeof item.endpoint !== 'string' || typeof item.keys?.p256dh !== 'string' || typeof item.keys.auth !== 'string')) throw new Error('invalid push subscription state');
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
      const state = structuredClone(await this.read());
      const changed = change(state);
      if (changed.next === state) return changed.result;
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const directory = await lstat(dirname(this.path));
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw new Error('unsafe push store directory');
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
