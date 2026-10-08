import { test, expect } from 'bun:test';
import { readPendingPushObservations } from './push-source.ts';
import { PersonaRegistry } from './persona-registry.ts';
import { daemonConfigFromEnv } from './config.ts';

test('approval source maps real registry ownership, keeps concrete transcript operation, and never collects legacy or unowned tasks', async () => {
  const cfg = daemonConfigFromEnv({});
  const registry = new PersonaRegistry('/unused/registry.json', async () => JSON.stringify({ version: 1, personas: [{ id: 'persona-real', spaceId: 'w1', mainPaneId: 'main', name: 'Work' }], archivedSpaces: [], orphans: [] }));
  const screen = 'Bash command\n\n  mkfifo fixture-fifo\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend';
  const screenReads: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/snapshot')) return Response.json({ bridge: 'connected', agents: [
      { paneId: 'main', workspaceId: 'w1', status: 'blocked' }, { paneId: 'task', workspaceId: 'w1', status: 'blocked' },
      { paneId: 'unregistered-task', workspaceId: 'w1', status: 'blocked' }, { paneId: 'legacy', workspaceId: 'legacy', status: 'blocked' },
    ] });
    screenReads.push(String(input)); return Response.json({ text: screen, truncated: false });
  };
  const observations = await readPendingPushObservations(cfg, fetcher, registry, async paneId => paneId === 'task' ? { personaId: 'persona-real', spaceId: 'w1', paneId, occurrenceKey: 'trusted-run' } : undefined);
  expect(observations).toHaveLength(2);
  expect(observations[0]).toMatchObject({ personaId: 'persona-real', binding: 'main:persona-real:w1:main', task: false, state: 'pending' });
  expect(observations[1]).toMatchObject({ personaId: 'persona-real', binding: 'task:trusted-run', task: true });
  expect(observations[0]?.summary).toContain('mkfifo fixture-fifo');
  expect(screenReads.some(url => /legacy|unregistered-task/.test(url))).toBe(false);
});
