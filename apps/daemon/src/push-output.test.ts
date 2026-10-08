import { test, expect } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PushStore, emptyPushState } from './push-store.ts';
import { createPushOutput } from './push-output.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { SessionLock } from './session-lock.ts';

test('same occurrence sends once across restart, new occurrence can notify', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-output-'));
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
    const cancellable = make();
    const queued = cancellable.send({ ...payload, tag: 'cancel-before-send', occurrenceKey: 'instance-3' });
    await cancellable.retract('cancel-before-send');
    expect((await queued).suppressed).toBe(1);
    expect(sent).toHaveLength(2);
    let failedCalls = 0;
    const failedOutput = () => createPushOutput({ store: new PushStore(path), transport: { send: async () => { failedCalls++; return { status: 'failed' }; } }, clock: { now: () => 124 }, admission: admissions.pushDeliver, cleanupAdmission: admissions.pushCleanup });
    expect((await failedOutput().send({ ...payload, occurrenceKey: 'uncertain-send' })).failed).toBe(1);
    expect((await failedOutput().send({ ...payload, occurrenceKey: 'uncertain-send' })).suppressed).toBe(1);
    expect(failedCalls).toBe(1);
    const invalidOutput = createPushOutput({ store: new PushStore(path), transport: { send: async () => ({ status: 'invalid' }) }, clock: { now: () => 125 }, admission: admissions.pushDeliver, cleanupAdmission: admissions.pushCleanup });
    expect((await invalidOutput.send({ ...payload, occurrenceKey: 'expired-subscription' })).invalid).toBe(1);
    expect((await new PushStore(path).load()).subscriptions).toHaveLength(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an already persisted delivery is suppressed without entering another claim mutation', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
  const occurrenceKey = 'already-claimed';
  const key = createHash('sha256').update(occurrenceKey).update('\0').update(endpoint).digest('hex');
  const state = { ...emptyPushState(), subscriptions: [{ endpoint, keys: { p256dh: 'test', auth: 'test' }, owner: 'alice' }], deliveries: { [key]: 0 } };
  const caps = createDaemonSystemAdmissions();
  const output = createPushOutput({
    store: { load: async () => state, mutate: async () => { throw new Error('must not mutate'); } },
    transport: { send: async () => { throw new Error('must not send'); } },
    clock: { now: () => 123 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup,
  });
  expect(await output.send({ version: 1, type: 'notification', title: 'Work', body: 'specific operation', tag: 'claimed', url: '/lite/persona/alice', occurrenceKey })).toEqual({ sent: 0, invalid: 0, failed: 0, suppressed: 1 });
});
