import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushStore } from './push-store.ts';
import { PendingPushLedger } from './push-pending.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';

test('pending occurrence survives daemon restart, gap cannot settle, explicit resolution and new task instance can notify again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-pending-'));
  try {
    const path = join(dir, 'push.json'); const admission = createDaemonSystemAdmissions().pushDeliver;
    const make = () => new PendingPushLedger(new PushStore(path), admission);
    const observation = { state: 'pending' as const, binding: 'task:instance-1', personaId: 'real-persona', personaName: 'Work', paneId: 'task-1', task: true, identity: 'approval-subject', summary: '需要你批准 mkfifo fixture-fifo' };
    const first = await make().observe(observation);
    const afterRestart = await make().observe(observation);
    expect(afterRestart?.payload?.occurrenceKey).toBe(first?.payload?.occurrenceKey);
    expect(first?.payload?.url).toBe('/lite/t/task-1?occurrence=instance-1');
    await make().observe({ ...observation, state: 'unknown' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).toBe(first?.payload?.occurrenceKey);
    expect((await make().observe({ ...observation, binding: 'task:instance-2' }))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
    await make().observe({ ...observation, state: 'resolved' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
    const main = { ...observation, task: false, binding: 'main:real-persona:w1:old-main', paneId: 'old-main' };
    const oldMain = await make().observe(main);
    const retired = await make().retainBindings(new Set(['main:real-persona:w1:new-main']));
    expect(retired.some(event => event.tag === oldMain?.tag)).toBe(true);
    const newMain = await make().observe({ ...main, binding: 'main:real-persona:w1:new-main', paneId: 'new-main' });
    expect(newMain?.payload?.occurrenceKey).not.toBe(oldMain?.payload?.occurrenceKey);
    expect(newMain?.payload?.url).toBe('/lite/persona/real-persona');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
