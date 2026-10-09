import { expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PushPayload } from '@homeling/contracts';
import { createPushPolling } from './push-runtime.ts';
import { PushEventConsumer } from './push-events.ts';
import { PushStore } from './push-store.ts';
import { createPushOutput } from './push-output.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';
import { readPendingPushBatch } from './push-source.ts';
import { PersonaRegistry } from './persona-registry.ts';
import { daemonConfigFromEnv } from './config.ts';

const screen = 'Bash command\n\n  mkfifo fixture-fifo\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend';

test('production polling source→consumer→durable output debounces across polls, coalesces, cancels resolved members and stops', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-push-polling-'));
  try {
    const store = new PushStore(join(dir, 'push.json')); const caps = createDaemonSystemAdmissions();
    await store.mutate(state => ({ next: { ...state, subscriptions: [{ endpoint: 'fake', keys: { p256dh: 'fake', auth: 'fake' }, owner: 'alice' }] }, result: undefined }), caps.pushDeliver);
    const registry = new PersonaRegistry('/unused', async () => JSON.stringify({ version: 1, personas: [
      { id: 'a', spaceId: 'w1', mainPaneId: 'a', name: 'Alice' }, { id: 'b', spaceId: 'w2', mainPaneId: 'b', name: 'Bob' },
    ], archivedSpaces: [], orphans: [] }));
    let now = 0; let status = 'working'; let dispatched!: () => void;
    let dispatchPromise = new Promise<void>(resolve => { dispatched = resolve; });
    const sent: PushPayload[] = [];
    const output = createPushOutput({ store, clock: { now: () => now }, admission: caps.pushDeliver, cleanupAdmission: caps.pushCleanup, transport: {
      send: async (_, payload) => { sent.push(payload); dispatched(); return new Promise(() => {}); },
    } });
    const consumer = new PushEventConsumer({ store, clock: { now: () => now }, output, admission: caps.pushDeliver, registry, activity: { list: async () => ({ occurrences: [], events: [], observation: 'live' }) } });
    const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/snapshot')
      ? Response.json({ bridge: 'connected', agents: [{ paneId: 'a', workspaceId: 'w1', status }, { paneId: 'b', workspaceId: 'w2', status }] })
      : Response.json({ text: screen, truncated: false });
    const polling = createPushPolling(consumer, () => readPendingPushBatch(daemonConfigFromEnv({}), fetcher, registry, async () => []));
    await polling.poll(); // A trustworthy resolved baseline, not a made-up creation event.
    status = 'blocked'; now = 2500; await polling.poll(); expect(sent).toHaveLength(0);
    now = 5000; await polling.poll(); expect(sent).toHaveLength(0);
    now = 7500; await polling.poll(); await dispatchPromise;
    expect(sent).toHaveLength(1); expect(sent[0]!.titleTemplate?.params.count).toBe(2);
    // Hung external delivery must not hold up the next real source reconciliation.
    status = 'working'; now = 10000; await polling.poll();
    expect((await store.load()).retractTags).toContain(sent[0]!.tag);
    dispatchPromise = new Promise<void>(resolve => { dispatched = resolve; });
    status = 'blocked'; now = 12500; await polling.poll(); polling.stop();
    now = 17500; await polling.poll(); expect(sent).toHaveLength(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
