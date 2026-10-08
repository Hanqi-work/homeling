import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { postPushRetractions } from '../push-client.ts';

test('actual foreground sender carries resolved tags to the lite worker and closes its displayed notification, never Collie or another origin', async () => {
  const handlers = new Map<string, (event: any) => void>(); let closed = 0; let work: Promise<unknown> = Promise.resolve();
  const self = { location: { origin: 'https://home.example' }, addEventListener: (kind: string, fn: (event: any) => void) => handlers.set(kind, fn), registration: { getNotifications: async ({ tag }: { tag: string }) => tag === 'homeling-request-resolved' ? [{ close() { closed++; } }] : [] } };
  runInNewContext(await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
  let posted = 0;
  const registration = { scope: 'https://home.example/lite/', active: { postMessage(data: unknown) { posted++; handlers.get('message')!({ data, source: { url: 'https://home.example/lite/p/task' }, waitUntil(pending: Promise<unknown>) { work = pending; } }); } } } as unknown as ServiceWorkerRegistration;
  const status = { publicKey: 'public', preferences: { enabled: true }, subscriptions: [], retractTags: ['homeling-request-resolved', 'collie-notification'] };
  expect(postPushRetractions(registration, status, 'https://home.example')).toBe(1);
  await work; expect(closed).toBe(1);
  for (const scope of ['https://home.example/', 'https://home.example/liteevil/', 'https://evil.example/lite/']) expect(postPushRetractions({ ...registration, scope } as ServiceWorkerRegistration, status, 'https://home.example')).toBe(0);
  expect(posted).toBe(1);
});

test('actual lite worker shows specific summary and clicks only same-origin lite deep-links', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const shown: unknown[] = []; const opened: string[] = [];
  const self = { location: { origin: 'https://home.example' }, addEventListener: (kind: string, fn: (event: any) => void) => handlers.set(kind, fn), registration: { showNotification: async (title: string, options: unknown) => { shown.push({ title, options }); }, getNotifications: async () => [] }, clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } } };
  runInNewContext(await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
  let work: Promise<unknown> = Promise.resolve(); const waitUntil = (promise: Promise<unknown>) => { work = promise; };
  handlers.get('push')?.({ data: { json: () => ({ version: 1, type: 'notification', title: 'Work', body: '需要你批准 mkfifo fixture-fifo', tag: 'request-1', url: '/lite/persona/p1', occurrenceKey: 'o1' }) }, waitUntil });
  await work;
  expect(shown).toEqual([{ title: 'Work', options: { body: '需要你批准 mkfifo fixture-fifo', tag: 'request-1', icon: '/lite/icons/icon-192.png', badge: '/lite/icons/icon-192.png', data: { url: 'https://home.example/lite/persona/p1' } } }]);
  handlers.get('notificationclick')?.({ notification: { close() {}, data: { url: 'https://evil.example/phish' } }, waitUntil });
  await work; expect(opened).toEqual(['https://home.example/lite/']);
  handlers.get('notificationclick')?.({ notification: { close() {}, data: { url: '/lite/t/task-1' } }, waitUntil });
  await work; expect(opened[1]).toBe('https://home.example/lite/t/task-1');
});

test('notification click never hijacks Collie, reuses only exact lite clients and falls back when an existing lite tab disappears', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const opened: string[] = []; const navigated: string[] = []; let focused = 0; let rootTouched = 0;
  const root = { url: 'https://home.example/', navigate: async () => { rootTouched++; }, focus: async () => { rootTouched++; } };
  const lookalike = { ...root, url: 'https://home.example/liteevil/' };
  const lite = { url: 'https://home.example/lite/settings', navigate: async (url: string) => { navigated.push(url); return { focus: async () => { focused++; } }; } };
  let clients: unknown[] = [root, lookalike, lite];
  const self = { location: { origin: 'https://home.example' }, addEventListener: (kind: string, fn: (event: any) => void) => handlers.set(kind, fn), clients: { matchAll: async () => clients, openWindow: async (url: string) => { opened.push(url); } } };
  runInNewContext(await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
  const click = async (url: string) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get('notificationclick')!({ notification: { close() {}, data: { url } }, waitUntil: (work: Promise<unknown>) => { pending = work; } });
    await pending;
  };
  await click('/lite/persona/p1');
  expect(navigated).toEqual(['https://home.example/lite/persona/p1']); expect(focused).toBe(1); expect(rootTouched).toBe(0);
  clients = [root, lookalike];
  await click('/lite/t/p2?occurrence=real-run');
  expect(opened[0]).toBe('https://home.example/lite/t/p2?occurrence=real-run');
  await click('/'); await click('https://evil.example/lite/phish'); await click('/liteevil/');
  expect(opened.slice(1)).toEqual(['https://home.example/lite/', 'https://home.example/lite/', 'https://home.example/lite/']);
  clients = [{ ...lite, navigate: async () => { throw new Error('tab disappeared'); } }];
  await click('/lite/persona/p3');
  expect(opened.at(-1)).toBe('https://home.example/lite/persona/p3'); expect(rootTouched).toBe(0);
});
