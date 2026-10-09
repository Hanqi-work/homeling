import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Root } from 'react-dom/client';
import { ConversationPage } from './ConversationPage.tsx';
import { sessionState } from './session-state.ts';

const window = new Window();
const saved = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import('react-dom/client').createRoot;
let root: Root | undefined;
let container: HTMLElement;
const originalFetch = globalThis.fetch;
beforeAll(async () => {
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; container?.remove(); globalThis.fetch = originalFetch; sessionState.lock(); });
afterAll(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } window.close(); });
const occurrence = { occurrenceKey: 'run', personaId: 'persona-real', spaceId: 'w1', paneId: 'task', title: 'Approve FIFO', createdAt: '2026-10-09T00:00:00Z', status: 'active' };
const route = '/p/task?occurrence=run';
async function mount() {
  sessionState.apply({ locked: false, epoch: 1, generation: 'test' }); sessionState.caughtUp();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/p/:paneId" element={<ConversationPage />} /></Routes></MemoryRouter>));
}

test('historical, wrong-pane, unknown and gap notification routes never mount live conversation cards, history or controls', async () => {
  const cases = [
    { occurrence: { ...occurrence, status: 'completed' }, current: false, observation: 'live', liveAvailable: false },
    { occurrence: { ...occurrence, paneId: 'reused-pane' }, current: true, observation: 'live', liveAvailable: true },
    { occurrence: { ...occurrence, status: 'unknown' }, current: true, observation: 'live', liveAvailable: false },
    { occurrence, current: true, observation: 'gap', liveAvailable: false },
  ];
  for (const metadata of cases) {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { calls.push(String(input)); return Response.json(metadata); }) as typeof fetch;
    await mount();
    expect(calls).toEqual(['/lite/api/activity/task/run']);
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('section[aria-label="待处理请求"]')).toBeNull();
    expect(container.querySelector('section[aria-label="特殊键"]')).toBeNull();
    await act(() => root!.unmount()); root = undefined; container.remove();
  }
});

test('current task notification route renders the real approval card through scoped reads and submits its trusted occurrence', async () => {
  const calls: string[] = []; let submitted: unknown;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/activity/task/run')) return Response.json({ occurrence, current: true, observation: 'live', liveAvailable: true });
    if (url.endsWith('/activity/task/run/history')) return Response.json({ paneId: 'task', available: true, entries: [], hasMore: false, total: 0, fileTruncated: false });
    if (url.endsWith('/activity/task/run/requests')) return Response.json([{ id: 'request-run', paneId: 'task', personaId: 'persona-real', taskOccurrenceKey: 'run', status: 'pending', createdAt: occurrence.createdAt, kind: 'prompt-select', payload: { question: 'Do you want to proceed?', subject: ['mkfifo fixture-fifo'], options: [{ id: '1', label: 'Yes' }, { id: '2', label: 'No' }] } }]);
    if (url.endsWith('/requests/request-run/approve')) { submitted = JSON.parse(String(init?.body)); return Response.json({ status: 'resolved', outcome: 'submitted' }); }
    if (url.endsWith('/launchers')) return Response.json({ launchers: [] });
    if (url.endsWith('/snapshot')) return Response.json({ bridge: 'connected', ts: Date.now(), agents: [{ paneId: 'task', workspaceId: 'w1', tabId: 't1', agent: 'claude', cwd: '/work', status: 'blocked' }], shellPanes: [], workspaces: [], tabs: [], sessions: [] });
    throw new Error(`unexpected unscoped read ${url}`);
  }) as typeof fetch;
  await mount();
  expect(calls).toContain('/lite/api/activity/task/run/history');
  expect(calls).toContain('/lite/api/activity/task/run/requests');
  expect(calls).not.toContain('/lite/api/pane/task/history');
  expect(calls).not.toContain('/lite/api/requests');
  expect(container.textContent).toContain('mkfifo fixture-fifo');
  const yes = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Yes');
  expect(yes).toBeDefined();
  await act(async () => { yes!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event); });
  expect(submitted).toEqual({ optionId: '1', occurrenceKey: 'run' });
});
