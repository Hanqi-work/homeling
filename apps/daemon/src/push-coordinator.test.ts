import { expect, test } from 'bun:test';
import type { PushPayload } from '@homeling/contracts';
import { PushCoordinator } from './push-coordinator.ts';
import { PushStore, emptyPushState, type PushPersistence, type PushState } from './push-store.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { createPushOutput } from './push-output.ts';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fixture() {
  let state = emptyPushState();
  const store: PushPersistence = {
    load: async () => structuredClone(state),
    async mutate(change, admission) { admission.assert(); const changed = change(structuredClone(state)); admission.dispatch(() => { state = structuredClone(changed.next); }); return changed.result; },
  };
  let now = 0;
  const sent: PushPayload[] = [];
  const retracted: string[] = [];
  const make = () => new PushCoordinator({ store, clock: { now: () => now }, debounceMs: 1000,
    output: { send: async payload => { sent.push(payload); return { sent: 1, invalid: 0, failed: 0, suppressed: 0 }; }, retract: async tag => { retracted.push(tag); } },
    admission: createDaemonSystemAdmissions().pushDeliver,
  });
  const pending = { state: 'pending' as const, binding: 'persona-a:pane-a', personaId: 'persona-a', personaName: 'Alice', identity: 'approve mkfifo', summary: '需要你批准 mkfifo fixture-fifo', url: '/lite/persona/persona-a' };
  return { store, sent, retracted, make, pending, advance: (time: number) => { now = time; } };
}

test('unknown startup pending is fail-closed; a known new request self-resolving in the debounce window never sends', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([f.pending]);
  f.advance(2000); await coordinator.flush();
  expect(f.sent).toEqual([]);
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending]);
  f.advance(2500); await coordinator.flush();
  expect(f.sent).toEqual([]);
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }]);
  f.advance(4000); await coordinator.flush();
  expect(f.sent).toEqual([]);
});

test('one debounce window coalesces requests and counts distinct personas, not requests or names', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([
    { state: 'resolved', binding: f.pending.binding },
    { state: 'resolved', binding: 'persona-a:task-a' },
    { state: 'resolved', binding: 'persona-b:pane-b' },
    f.pending,
    { ...f.pending, binding: 'persona-a:task-a', identity: 'approve second command' },
    { ...f.pending, binding: 'persona-b:pane-b', personaId: 'persona-b', personaName: 'Alice', summary: '需要你批准 git status' },
  ]);
  f.advance(999); await coordinator.flush(); expect(f.sent).toHaveLength(0);
  f.advance(1000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toMatchObject({ titleTemplate: { key: 'push.agentsNeedYou', params: { count: 2 } }, summaryTemplate: { key: 'push.agentsSummary', params: { count: 2 } }, url: '/lite/' });
  expect(f.sent[0]!.body).toContain('mkfifo fixture-fifo');
  expect(f.sent[0]!.body).toContain('git status');
});

test('restart suppresses old aggregate members, but a resolved request with identical content is a new occurrence', async () => {
  const f = fixture(); const first = f.make();
  const second = { ...f.pending, binding: 'persona-b:pane-b', personaId: 'persona-b' };
  await first.observePending([{ state: 'resolved', binding: f.pending.binding }, { state: 'resolved', binding: second.binding }, f.pending, second]);
  f.advance(1000); await first.flush();
  const original = f.sent[0]!.occurrenceKey;
  const restarted = f.make();
  await restarted.observePending([{ ...f.pending }, second]);
  f.advance(2000); await restarted.flush(); expect(f.sent).toHaveLength(1);
  await restarted.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending, second]);
  f.advance(3000); await restarted.flush(); expect(f.sent).toHaveLength(2);
  expect(f.sent[1]!.body).toBe('需要你批准 mkfifo fixture-fifo');
  expect(f.sent[1]!.occurrenceKey).not.toBe(original);
});

test('resolving a sent aggregate member retracts the aggregate tag after restart without silent push', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, { state: 'resolved', binding: 'persona-b:pane-b' }, f.pending, { ...f.pending, binding: 'persona-b:pane-b', personaId: 'persona-b' }]);
  f.advance(1000); await coordinator.flush();
  const aggregateTag = f.sent[0]!.tag;
  await f.make().observePending([{ state: 'resolved', binding: f.pending.binding }]);
  expect(f.retracted).toContain(aggregateTag);
  expect(f.sent).toHaveLength(1);
});

test('resolution atomically persists the aggregate tombstone even if the next coordination write fails', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, { state: 'resolved', binding: 'b' }, f.pending, { ...f.pending, binding: 'b', personaId: 'b' }]);
  f.advance(1000); await coordinator.flush(); const tag = f.sent[0]!.tag;
  const mutate = f.store.mutate.bind(f.store);
  let committedResolution = false;
  f.store.mutate = async (change, admission) => {
    if (committedResolution) throw new Error('crash after resolution commit');
    const result = await mutate(change, admission);
    committedResolution = Object.values((await f.store.load()).pendingOccurrences).some(item => !item.active);
    return result;
  };
  await expect(coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }])).rejects.toThrow('crash after resolution commit');
  expect((await f.store.load()).retractTags).toContain(tag);
});

test('staggered arrivals share a debounce window while every member gets time to self-resolve', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending]);
  f.advance(500);
  await coordinator.observePending([{ state: 'resolved', binding: 'b' }, { ...f.pending, binding: 'b', personaId: 'b' }]);
  f.advance(1000); await coordinator.flush(); expect(f.sent).toHaveLength(0);
  f.advance(1500); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  expect(f.sent[0]!.titleTemplate?.params.count).toBe(2);
});

test('invalid subscription cleanup failure cannot prevent delivery to a healthy subscription', async () => {
  let state: PushState = { ...emptyPushState(), subscriptions: ['expired', 'healthy'].map(endpoint => ({ endpoint, keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' })) };
  const sent: string[] = [];
  const store: PushPersistence = {
    load: async () => structuredClone(state),
    async mutate(change, admission) {
      admission.assert();
      if ('scope' in admission && admission.scope === 'push.cleanup') throw new Error('cleanup storage unavailable');
      const changed = change(structuredClone(state)); state = structuredClone(changed.next); return changed.result;
    },
  };
  const caps = createDaemonSystemAdmissions();
  const output = createPushOutput({ store, clock: { now: () => 0 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup,
    transport: { send: async subscription => { sent.push(subscription.endpoint); return { status: subscription.endpoint === 'expired' ? 'invalid' : 'sent' }; } },
  });
  const coordinator = new PushCoordinator({ store, output, clock: { now: () => 0 }, debounceMs: 0, admission: caps.pushDeliver });
  await coordinator.observePending([{ state: 'resolved', binding: 'live' }, { state: 'pending', binding: 'live', personaId: 'alice', personaName: 'Alice', identity: 'operation', summary: 'approve mkfifo', url: '/lite/persona/alice' }]);
  await expect(coordinator.flush()).rejects.toThrow('cleanup storage unavailable');
  expect(sent).toEqual(['expired', 'healthy']);
});

test('persisted retract tombstones cancel a send through a restarted actual output', async () => {
  const f = fixture(); const caps = createDaemonSystemAdmissions();
  await f.store.mutate(state => ({ next: { ...state, subscriptions: [{ endpoint: 'healthy', keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' }] }, result: undefined }), caps.pushDeliver);
  let calls = 0;
  const output = () => createPushOutput({ store: f.store, clock: { now: () => 0 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup, transport: { send: async () => { calls++; return { status: 'sent' }; } } });
  await output().retract('resolved-tag');
  expect((await output().send({ version: 1, type: 'notification', title: 'Alice', body: 'old', tag: 'resolved-tag', url: '/lite/', occurrenceKey: 'old-uncertain' })).suppressed).toBe(1);
  expect(calls).toBe(0);
});

test('resolution committed after claim but before dispatch suppresses the queued external effect', async () => {
  const f = fixture(); const caps = createDaemonSystemAdmissions();
  await f.store.mutate(state => ({ next: { ...state, subscriptions: [{ endpoint: 'healthy', keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' }] }, result: undefined }), caps.pushDeliver);
  const mutate = f.store.mutate.bind(f.store);
  let retireAfterClaim = true;
  f.store.mutate = async (change, admission) => {
    const result = await mutate(change, admission);
    if (retireAfterClaim && Object.keys((await f.store.load()).deliveries).length) {
      retireAfterClaim = false;
      await mutate(state => ({ next: { ...state, retractTags: ['retired'] }, result: undefined }), caps.pushDeliver);
    }
    return result;
  };
  let calls = 0;
  const output = createPushOutput({ store: f.store, clock: { now: () => 0 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup, transport: { send: async () => { calls++; return { status: 'sent' }; } } });
  expect((await output.send({ version: 1, type: 'notification', title: 'Alice', body: 'old', tag: 'retired', url: '/lite/', occurrenceKey: 'claim-race' })).suppressed).toBe(1);
  expect(calls).toBe(0);
});

test('corrupted durable coordinator claims fail closed rather than replaying old notifications', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-coordinator-corrupt-'));
  try {
    const path = join(dir, 'push.json');
    await writeFile(path, JSON.stringify({ ...emptyPushState(), coordination: { handled: { old: 42 }, baselines: [] } }), { mode: 0o600 });
    await expect(new PushStore(path).load()).rejects.toThrow('invalid push coordination state');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('real durable store and actual output survive two restarts; uncertainty and historical members are never replayed', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-coordinator-restart-'));
  try {
    const path = join(dir, 'push.json'); const caps = createDaemonSystemAdmissions();
    await new PushStore(path).mutate(state => ({ next: { ...state, subscriptions: [{ endpoint: 'healthy', keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' }] }, result: undefined }), caps.pushDeliver);
    const sent: PushPayload[] = [];
    const make = () => {
      const store = new PushStore(path);
      return new PushCoordinator({ store, clock: { now: () => 0 }, debounceMs: 0, admission: caps.pushDeliver,
        output: createPushOutput({ store, clock: { now: () => 0 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup, transport: { send: async (_, payload) => { sent.push(payload); return { status: 'failed' }; } } }),
      });
    };
    const pending = { state: 'pending' as const, binding: 'trusted-pane', personaId: 'alice', personaName: 'Alice', identity: 'mkfifo', summary: 'approve mkfifo', url: '/lite/persona/alice' };
    const first = make(); await first.observePending([{ state: 'resolved', binding: pending.binding }, pending]); await first.flush(); first.stop();
    const second = make(); await second.observePending([pending, { state: 'unknown', binding: pending.binding }]); await second.flush(); second.stop();
    const third = make(); await third.observePending([pending]); await third.flush(); expect(sent).toHaveLength(1);
    await third.observePending([{ state: 'resolved', binding: pending.binding }, pending]); await third.flush();
    expect(sent).toHaveLength(2); expect(sent[1]!.occurrenceKey).not.toBe(sent[0]!.occurrenceKey);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('observation gaps retain a trusted request; durable binding retirement cancels unsent requests', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending, { state: 'unknown', binding: f.pending.binding }]);
  await coordinator.retainBindings(new Set([f.pending.binding]));
  f.advance(1000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  await coordinator.observePending([{ state: 'resolved', binding: 'task-later' }, { ...f.pending, binding: 'task-later' }]);
  await coordinator.retainBindings(new Set([f.pending.binding]));
  f.advance(2000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  expect(Object.values((await f.store.load()).pendingOccurrences).find(item => item.binding === 'task-later')?.active).toBe(false);
});

test('unknown same-content incarnation stays closed, but a full prompt identity replacement is new', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([f.pending]);
  f.advance(1000); await coordinator.flush(); expect(f.sent).toHaveLength(0);
  await f.make().observePending([f.pending]);
  f.advance(2000); await coordinator.flush(); expect(f.sent).toHaveLength(0);
  await coordinator.observePending([{ ...f.pending, identity: 'approve rm -rf data', summary: '需要你批准 rm -rf data' }]);
  f.advance(3000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  const key = f.sent[0]!.occurrenceKey;
  await coordinator.observePending([{ ...f.pending, identity: 'approve rm -rf data', summary: 'Approve rm -rf data', personaName: 'Renamed' }]);
  f.advance(4000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
  expect(f.sent[0]!.occurrenceKey).toBe(key);
});

test('successful invalid cleanup preserves healthy sends and cannot revive an old claim when reenrolled', async () => {
  const f = fixture(); const caps = createDaemonSystemAdmissions();
  const subscriptions = ['expired', 'healthy'].map(endpoint => ({ endpoint, keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' }));
  await f.store.mutate(state => ({ next: { ...state, subscriptions }, result: undefined }), caps.pushDeliver);
  const calls: string[] = [];
  const output = createPushOutput({ store: f.store, clock: { now: () => 0 }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup, transport: { send: async subscription => { calls.push(subscription.endpoint); return { status: subscription.endpoint === 'expired' ? 'invalid' : 'sent' }; } } });
  const coordinator = new PushCoordinator({ store: f.store, output, clock: { now: () => 0 }, debounceMs: 0, admission: caps.pushDeliver });
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending]);
  expect(await coordinator.flush()).toEqual({ sent: 1, invalid: 1, failed: 0, suppressed: 0 });
  expect((await f.store.load()).subscriptions.map(item => item.endpoint)).toEqual(['healthy']);
  await f.store.mutate(state => ({ next: { ...state, subscriptions }, result: undefined }), caps.pushDeliver);
  await coordinator.observePending([f.pending]); await coordinator.flush();
  expect(calls).toEqual(['expired', 'healthy']);
});

test('concurrent flushes claim only once and stop cancels queued work without sending', async () => {
  const f = fixture(); const coordinator = f.make();
  await coordinator.observePending([{ state: 'resolved', binding: f.pending.binding }, f.pending]);
  f.advance(1000); await Promise.all([coordinator.flush(), coordinator.flush()]); expect(f.sent).toHaveLength(1);
  await coordinator.observePending([{ state: 'resolved', binding: 'task-later' }, { ...f.pending, binding: 'task-later' }]);
  coordinator.stop(); f.advance(2000); await coordinator.flush(); expect(f.sent).toHaveLength(1);
});
