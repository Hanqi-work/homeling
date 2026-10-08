import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushStore } from './push-store.ts';
import { SessionLock, SessionLocked } from './session-lock.ts';

test('push subscriptions and preferences survive daemon restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-push-'));
  try {
    const path = join(dir, 'push.json');
    const store = new PushStore(path);
    const lock = new SessionLock();
    const { token } = lock.unlock('alice');
    await store.mutate(state => ({ next: { ...state, preferences: { enabled: false } }, result: undefined }), lock.admission(lock.admit(token, 'alice')));
    expect((await new PushStore(path).load()).preferences.enabled).toBe(false);
    lock.lock(token, 'alice');
    expect(() => store.mutate(state => ({ next: { ...state, preferences: { enabled: true } }, result: undefined }), lock.admission({} as never))).toThrow(SessionLocked);
    expect((await new PushStore(path).load()).preferences.enabled).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
