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
    expect(first?.payload?.url).toBe('/lite/t/task-1');
    await make().observe({ ...observation, state: 'unknown' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).toBe(first?.payload?.occurrenceKey);
    expect((await make().observe({ ...observation, binding: 'task:instance-2' }))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
    await make().observe({ ...observation, state: 'resolved' });
    expect((await make().observe(observation))?.payload?.occurrenceKey).not.toBe(first?.payload?.occurrenceKey);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
