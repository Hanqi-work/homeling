import { test, expect } from 'bun:test';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushStore } from './push-store.ts';
import { PendingPushLedger } from './push-pending.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { handlePushRequest } from './push-api.ts';

for (const kind of ['superseded', 'resolved-then-reopened'] as const) test(`${kind} notification keeps its exact retract tag across overwrite and restart before the next page poll`, async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-retract-restart-'));
  try {
    const path = join(dir, 'push.json'); const store = new PushStore(path);
    const ledger = new PendingPushLedger(store, createDaemonSystemAdmissions().pushDeliver);
    const observation = { state: 'pending' as const, binding: 'same-binding', identity: 'old-operation', personaName: 'Work', summary: '批准 mkfifo old', url: '/lite/persona/p' };
    const old = await ledger.observe(observation);
    if (kind === 'resolved-then-reopened') await ledger.observe({ state: 'resolved', binding: observation.binding });
    const current = await ledger.observe({ ...observation, identity: 'new-operation', summary: '批准 mkfifo new' });
    expect(current?.tag).not.toBe(old?.tag);
    const restarted = new PushStore(path);
    const runtime = { store: restarted, publicKey: 'public', transport: { send: async () => ({ status: 'sent' as const }) } };
    const response = await handlePushRequest(new Request('https://home.example/lite/api/push/status'), runtime, 'alice');
    const status = await response!.json();
    expect(status.retractTags).toContain(old!.tag);
    const handlers = new Map<string, (event: any) => void>(); let closed = 0; let pending: Promise<unknown> = Promise.resolve();
    const self = { location: { origin: 'https://home.example' }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), registration: { getNotifications: async ({ tag }: { tag: string }) => tag === old!.tag ? [{ close() { closed++; } }] : [] } };
    runInNewContext(await readFile(new URL('../../web/public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
    const clientModule = new URL('../../web/src/push-client.ts', import.meta.url);
    const { postPushRetractions } = await import(clientModule.href);
    postPushRetractions({ scope: 'https://home.example/lite/', active: { postMessage(data: unknown) { handlers.get('message')!({ data, source: { url: 'https://home.example/lite/persona/p' }, waitUntil(work: Promise<unknown>) { pending = work; } }); } } }, status, 'https://home.example');
    await pending; expect(closed).toBe(1);
    expect((await restarted.load()).pendingOccurrences).toEqual((await store.load()).pendingOccurrences);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pending occurrence survives daemon restart, gap cannot settle, explicit resolution and new task instance can notify again', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-pending-'));
  try {
    const path = join(dir, 'push.json'); const admission = createDaemonSystemAdmissions().pushDeliver;
    const make = () => new PendingPushLedger(new PushStore(path), admission);
    const observation = { state: 'pending' as const, binding: 'opaque-instance-1', personaName: 'Work', url: '/lite/p/task-1?occurrence=instance-1', identity: 'approval-subject', summary: '需要你批准 mkfifo fixture-fifo' };
    const first = await make().observe(observation);
    const afterRestart = await make().observe(observation);
    expect(afterRestart?.payload?.occurrenceKey).toBe(first?.payload?.occurrenceKey);
    expect(first?.payload?.url).toBe(observation.url);
    await make().observe({ binding: observation.binding, state: 'unknown' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).toBe(first?.payload?.occurrenceKey);
    expect((await make().observe({ ...observation, binding: 'task:instance-2' }))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
    await make().observe({ binding: observation.binding, state: 'resolved' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
    const main = { ...observation, binding: 'main:real-persona:w1:old-main', url: '/lite/persona/real-persona' };
    const oldMain = await make().observe(main);
    const retired = await make().retainBindings(new Set(['main:real-persona:w1:new-main']));
    expect(retired.some(event => event.tag === oldMain?.tag)).toBe(true);
    const newMain = await make().observe({ ...main, binding: 'main:real-persona:w1:new-main' });
    expect(newMain?.payload?.occurrenceKey).not.toBe(oldMain?.payload?.occurrenceKey);
    expect(newMain?.payload?.url).toBe('/lite/persona/real-persona');
    const changed = await make().observe({ ...main, binding: 'main:real-persona:w1:new-main', identity: 'different-operation' });
    expect(changed?.supersededTag).toBe(newMain?.tag);
    expect(changed?.payload?.occurrenceKey).not.toBe(newMain?.payload?.occurrenceKey);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
