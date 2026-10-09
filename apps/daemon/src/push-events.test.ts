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

test('activity sequence and push cursor survive restart, while a trusted new launch can notify', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-push-cursor-'));
  try {
    const activityPath = join(dir, 'activity.json'); const pushPath = join(dir, 'push.json');
    const caps = createDaemonSystemAdmissions(); const lock = new SessionLock(); const { token } = lock.unlock('alice');
    const sent: string[] = [];
    const make = (activity: ActivityLedger) => new PushEventConsumer({ store: new PushStore(pushPath), activity,
      registry: { get: async () => ({ name: 'Work' }) }, admission: caps.pushDeliver,
      output: { send: async payload => { sent.push(payload.occurrenceKey); return { sent: 1, invalid: 0, failed: 0, suppressed: 0 }; }, retract: async () => {} },
    });
    let activity = new ActivityLedger(activityPath);
    await activity.register({ personaId: 'real', spaceId: 'w1', paneId: 'p1', title: 'Build' }, lock.admission(lock.admit(token, 'alice')));
    await activity.observe('pane_agent_status_changed', { pane_id: 'p1', workspace_id: 'w1', agent_status: 'working' }, caps.activityObserve);
    await activity.observe('pane_agent_status_changed', { pane_id: 'p1', workspace_id: 'w1', agent_status: 'done' }, caps.activityObserve);
    await make(activity).drainActivity(); expect(sent).toHaveLength(1);
    activity = new ActivityLedger(activityPath); const restarted = make(activity);
    await restarted.drainActivity(); expect(sent).toHaveLength(1);
    // A new trusted launch is observable after restart; don't invent a lost work cycle from a snapshot.
    await activity.register({ personaId: 'real', spaceId: 'w1', paneId: 'p2', title: 'Build again' }, lock.admission(lock.admit(token, 'alice')));
    await activity.observe('pane_agent_status_changed', { pane_id: 'p2', workspace_id: 'w1', agent_status: 'working' }, caps.activityObserve);
    await activity.observe('pane_agent_status_changed', { pane_id: 'p2', workspace_id: 'w1', agent_status: 'done' }, caps.activityObserve);
    await restarted.drainActivity(); expect(sent).toHaveLength(2); expect(sent[1]).not.toBe(sent[0]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a pending send that never completes does not block the following resolution observation', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-push-observe-'));
  try {
    const store = new PushStore(join(dir, 'push.json'));
    const retracted: string[] = [];
    const sent: string[] = [];
    let dispatchStarted!: () => void;
    const dispatched = new Promise<void>(resolve => { dispatchStarted = resolve; });
    const consumer = new PushEventConsumer({
      store, activity: { list: async () => ({ occurrences: [], events: [], observation: 'live' }) },
      registry: { get: async () => undefined },
      output: {
        send: async payload => { sent.push(payload.tag); dispatchStarted(); return new Promise(() => {}); },
        retract: async tag => { retracted.push(tag); },
      },
      admission: createDaemonSystemAdmissions().pushDeliver, debounceMs: 0,
    });
    await consumer.observePending([
      { state: 'resolved', binding: 'opaque' },
      { state: 'pending', binding: 'opaque', personaId: 'real', personaName: 'Work', identity: 'operation', summary: 'approve operation', url: '/lite/persona/real' },
    ]);
    void consumer.flushPending();
    await dispatched;
    await consumer.observePending([{ state: 'resolved', binding: 'opaque' }]);
    expect(sent).toHaveLength(1);
    expect(retracted).toEqual(sent);
    expect(Object.values((await store.load()).pendingOccurrences)[0]?.active).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
