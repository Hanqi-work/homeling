import { afterEach, beforeEach, test, expect } from 'bun:test';
import { sessionState } from './session-state.ts';
beforeEach(() => { sessionState.apply({ locked: false, epoch: 1, generation: 'push-fixture' }); sessionState.caughtUp(); });
afterEach(() => sessionState.lock());
import { enablePush } from './push-client.ts';

test('lock and re-unlock during browser lookup cannot rebind an old enrollment to the new epoch', async () => {
  const held = Promise.withResolvers<PushSubscription | null>(); let subscribed = 0; let enrolled = 0;
  const registration = { scope: 'https://home.example/lite/', pushManager: { getSubscription: () => held.promise, subscribe: async () => { subscribed++; return { toJSON: () => ({}), unsubscribe: async () => true }; } } } as unknown as ServiceWorkerRegistration;
  const pending = enablePush(registration, 'AQID', async () => { enrolled++; });
  sessionState.lock(); sessionState.apply({ locked: false, epoch: 2, generation: 'push-fixture' }); sessionState.caughtUp(); held.resolve(null);
  await expect(pending).rejects.toThrow('session.locked');
  expect(subscribed).toBe(0); expect(enrolled).toBe(0);
});

test('an already-started native allocation is compensated, never enrolled, when its original epoch expires', async () => {
  const started = Promise.withResolvers<void>(); const held = Promise.withResolvers<PushSubscription>(); let removed = 0; let enrolled = 0;
  const subscription = { toJSON: () => ({}), unsubscribe: async () => { removed++; return true; } } as unknown as PushSubscription;
  const registration = { scope: 'https://home.example/lite/', pushManager: { getSubscription: async () => null, subscribe: async () => { started.resolve(); return held.promise; } } } as unknown as ServiceWorkerRegistration;
  const pending = enablePush(registration, 'AQID', async () => { enrolled++; });
  await started.promise; sessionState.lock(); held.resolve(subscription);
  await expect(pending).rejects.toThrow('session.locked');
  expect(enrolled).toBe(0); expect(removed).toBe(1);
});

test('enrollment uses lite worker and removes newly created browser subscription if daemon refuses', async () => {
  let removed = 0; let subscribed = 0;
  const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test' }), unsubscribe: async () => { removed++; return true; } };
  const registration = { scope: 'https://home.example/lite/', pushManager: { getSubscription: async () => null, subscribe: async (options: unknown) => { subscribed++; expect(options).toMatchObject({ userVisibleOnly: true }); return subscription; } } } as unknown as ServiceWorkerRegistration;
  await expect(enablePush(registration, 'AQID', async () => { throw new Error('Unlock Homeling'); })).rejects.toThrow('Unlock Homeling');
  expect(subscribed).toBe(1); expect(removed).toBe(1);
  await expect(enablePush({ ...registration, scope: 'https://home.example/' } as ServiceWorkerRegistration, 'AQID', async () => {})).rejects.toThrow('lite');
  expect(subscribed).toBe(1);
});
