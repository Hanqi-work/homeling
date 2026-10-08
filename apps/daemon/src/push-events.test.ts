import { test, expect } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityLedger } from './activity-ledger.ts';
import { PushStore } from './push-store.ts';
import { PushEventConsumer } from './push-events.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { SessionLock } from './session-lock.ts';

test('actual trusted working→done activity produces completion deep-link; exit unknown never produces failure notification', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-events-'));
  try {
    const ledger = new ActivityLedger(join(dir, 'activity.json')); const store = new PushStore(join(dir, 'push.json'));
    const caps = createDaemonSystemAdmissions(); const lock = new SessionLock(); const { token } = lock.unlock('alice'); const user = lock.admission(lock.admit(token, 'alice'));
    const occurrence = await ledger.register({ personaId: 'persona-real', spaceId: 'w1', paneId: 'p1', title: 'Build fixtures' }, user);
    const sent: any[] = [];
    const consumer = new PushEventConsumer({ store, activity: ledger, registry: { get: async () => ({ name: 'Work' }) }, output: { send: async (payload: unknown) => { sent.push(payload); return { sent: 1, invalid: 0, failed: 0, suppressed: 0 }; }, retract: async () => {} }, admission: caps.pushDeliver });
    await consumer.drainActivity();
    await ledger.observe('pane_agent_status_changed', { pane_id: 'p1', workspace_id: 'w1', agent_status: 'working' }, caps.activityObserve);
    await ledger.observe('pane_agent_status_changed', { pane_id: 'p1', workspace_id: 'w1', agent_status: 'done' }, caps.activityObserve);
    await consumer.drainActivity(); await consumer.drainActivity();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ body: '任务完成：Build fixtures', url: `/lite/t/p1?occurrence=${occurrence.occurrenceKey}`, occurrenceKey: `${occurrence.occurrenceKey}:task.completed` });
    await ledger.register({ personaId: 'persona-real', spaceId: 'w1', paneId: 'p2', title: 'Unknown exit' }, user);
    await ledger.observe('pane_exited', { pane_id: 'p2', workspace_id: 'w1' }, caps.activityObserve);
    await consumer.drainActivity(); expect(sent).toHaveLength(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a pending send that never completes does not block the following resolution observation', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-push-observe-'));
  try {
    const store = new PushStore(join(dir, 'push.json'));
    const retracted: string[] = [];
    const sent: string[] = [];
    const consumer = new PushEventConsumer({
      store, activity: { list: async () => ({ occurrences: [], events: [], observation: 'live' }) },
      registry: { get: async () => undefined },
      output: {
        send: async payload => { sent.push(payload.tag); return new Promise(() => {}); },
        retract: async tag => { retracted.push(tag); },
      },
      admission: createDaemonSystemAdmissions().pushDeliver,
    });
    await consumer.observePending([
      { state: 'pending', binding: 'opaque', personaName: 'Work', identity: 'operation', summary: 'approve operation', url: '/lite/persona/real' },
      { state: 'resolved', binding: 'opaque' },
    ]);
    expect(sent).toHaveLength(1);
    expect(retracted).toEqual(sent);
    expect(Object.values((await store.load()).pendingOccurrences)[0]?.active).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
