import { test, expect } from 'bun:test';
import { enablePush } from './push-client.ts';

test('enrollment uses lite worker and removes newly created browser subscription if daemon refuses', async () => {
  let removed = 0; let subscribed = 0;
  const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test' }), unsubscribe: async () => { removed++; return true; } };
  const registration = { scope: 'https://home.example/lite/', pushManager: { getSubscription: async () => null, subscribe: async (options: unknown) => { subscribed++; expect(options).toMatchObject({ userVisibleOnly: true }); return subscription; } } } as unknown as ServiceWorkerRegistration;
  await expect(enablePush(registration, 'AQID', async () => { throw new Error('Unlock Homeling'); })).rejects.toThrow('Unlock Homeling');
  expect(subscribed).toBe(1); expect(removed).toBe(1);
  await expect(enablePush({ ...registration, scope: 'https://home.example/' } as ServiceWorkerRegistration, 'AQID', async () => {})).rejects.toThrow('lite');
  expect(subscribed).toBe(1);
});
