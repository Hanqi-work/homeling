import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

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
