import { test, expect } from 'bun:test';
import { readPendingPushBatch } from './push-source.ts';
import { PersonaRegistry } from './persona-registry.ts';
import { daemonConfigFromEnv } from './config.ts';

const screen = 'Bash command\n\n  mkfifo fixture-fifo\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend';
function makeRegistry(): PersonaRegistry {
  return new PersonaRegistry('/unused/registry.json', async () => JSON.stringify({ version: 1, personas: [{ id: 'persona-real', spaceId: 'w1', mainPaneId: 'main', name: 'Work' }], archivedSpaces: [], orphans: [] }));
}

test('one fresh ownership projection routes main and latest durable tasks, rejecting legacy and mismatched owners', async () => {
  const registry = makeRegistry();
  const order: string[] = [];
  const list = registry.list.bind(registry);
  registry.list = async () => { order.push('registry'); return list(); };
  const screenReads: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/snapshot')) {
      order.push('snapshot');
      return Response.json({ bridge: 'connected', agents: [
        { paneId: 'main', workspaceId: 'w1', status: 'blocked' }, { paneId: 'task', workspaceId: 'w1', status: 'blocked' },
        { paneId: 'unregistered-task', workspaceId: 'w1', status: 'blocked' }, { paneId: 'legacy', workspaceId: 'legacy', status: 'blocked' },
        { paneId: 'wrong-persona', workspaceId: 'w1', status: 'blocked' }, { paneId: 'wrong-space', workspaceId: 'w1', status: 'blocked' },
      ] });
    }
    screenReads.push(String(input)); return Response.json({ text: screen, truncated: false });
  };
  const batch = await readPendingPushBatch(daemonConfigFromEnv({}), fetcher, registry, async () => {
    order.push('ownership');
    return [
      { personaId: 'persona-real', spaceId: 'w1', paneId: 'task', occurrenceKey: 'old-run' },
      { personaId: 'persona-real', spaceId: 'w1', paneId: 'task', occurrenceKey: 'trusted-run' },
      { personaId: 'missing', spaceId: 'w1', paneId: 'wrong-persona', occurrenceKey: 'bad-persona' },
      { personaId: 'persona-real', spaceId: 'wrong', paneId: 'wrong-space', occurrenceKey: 'bad-space' },
    ];
  });
  expect(order).toEqual(['snapshot', 'registry', 'ownership']);
  expect([...batch.validBindings]).toEqual(['main:persona-real:w1:main', 'task:trusted-run']);
  expect(batch.observations).toHaveLength(2);
  expect(batch.observations[0]).toMatchObject({ binding: 'main:persona-real:w1:main', state: 'pending', url: '/lite/persona/persona-real' });
  expect(batch.observations[1]).toMatchObject({ binding: 'task:trusted-run', state: 'pending', url: '/lite/p/task?occurrence=trusted-run' });
  const main = batch.observations[0];
  expect(main?.state === 'pending' && main.summary).toContain('mkfifo fixture-fifo');
  expect(screenReads).toHaveLength(2);
});

test('missing panes and failed, truncated, or unrecognized screens cannot settle; explicit states carry only binding', async () => {
  const tasks = ['missing', 'failed', 'truncated', 'unrecognized', 'unknown', 'resolved'].map(paneId => ({ personaId: 'persona-real', spaceId: 'w1', paneId, occurrenceKey: paneId }));
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/snapshot')) {
      const agents = tasks.filter(task => task.paneId !== 'missing').map(task => {
        let status = 'blocked';
        if (task.paneId === 'unknown') status = 'unknown';
        if (task.paneId === 'resolved') status = 'working';
        return { paneId: task.paneId, workspaceId: 'w1', status };
      });
      return Response.json({ bridge: 'connected', agents });
    }
    if (url.endsWith('/failed')) return new Response(null, { status: 503 });
    if (url.endsWith('/truncated')) return Response.json({ text: screen, truncated: true });
    return Response.json({ text: 'unrecognized screen' });
  };
  const batch = await readPendingPushBatch(daemonConfigFromEnv({}), fetcher, makeRegistry(), async () => tasks);
  expect(batch.validBindings.size).toBe(7);
  expect(batch.observations).toEqual([{ state: 'unknown', binding: 'task:unknown' }, { state: 'resolved', binding: 'task:resolved' }]);
});

test('snapshot failure cannot produce a retirement batch or read ownership', async () => {
  for (const response of [new Response(null, { status: 503 }), Response.json({ bridge: 'disconnected' })]) {
    let reads = 0;
    await expect(readPendingPushBatch(daemonConfigFromEnv({}), async () => response, makeRegistry(), async () => { reads++; return []; })).rejects.toThrow();
    expect(reads).toBe(0);
  }
});
