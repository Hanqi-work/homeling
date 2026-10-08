import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushStore } from './push-store.ts';
import { createPushOutput } from './push-output.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { SessionLock } from './session-lock.ts';

test('same occurrence sends once across restart, new occurrence can notify', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-output-'));
  const admissions = createDaemonSystemAdmissions();
  try {
    const path = join(dir, 'push.json');
    const store = new PushStore(path);
    const lock = new SessionLock(); const { token } = lock.unlock('alice');
    await store.mutate(state => ({ next: { ...state, subscriptions: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'test', auth: 'test' }, owner: 'alice' }] }, result: undefined }), lock.admission(lock.admit(token, 'alice')));
    const sent: unknown[] = [];
    const transport = { send: async (_: unknown, payload: unknown) => { sent.push(payload); return { status: 'sent' as const }; } };
    const make = () => createPushOutput({ store: new PushStore(path), transport, clock: { now: () => 123 }, admission: admissions.pushDeliver, cleanupAdmission: admissions.pushCleanup });
    const payload = { version: 1 as const, type: 'notification' as const, title: 'Alice', body: '需要你批准 mkfifo fixture-fifo', tag: 'request-1', url: '/lite/persona/alice', occurrenceKey: 'instance-1' };
    await make().send(payload); await make().send(payload);
    expect(sent).toHaveLength(1);
    await make().send({ ...payload, occurrenceKey: 'instance-2' });
    expect(sent).toHaveLength(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
