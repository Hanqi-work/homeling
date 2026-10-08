import { test, expect } from 'bun:test';
import { createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushStore } from './push-store.ts';
import { handlePushRequest } from './push-api.ts';
import { SessionLock } from './session-lock.ts';

test('push enrollment fails closed while locked; enrollment, test-send and removal preserve user admission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-push-api-'));
  try {
    const store = new PushStore(join(dir, 'push.json')); const sent: unknown[] = [];
    const runtime = { store, publicKey: 'public', transport: { send: async (_: unknown, payload: unknown) => { sent.push(payload); return { status: 'sent' as const }; } } };
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } };
    const request = (action: string, body: unknown) => new Request(`https://home.example/lite/api/push/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await handlePushRequest(request('subscribe', subscription), runtime, 'alice'))?.status).toBe(423);
    expect((await store.load()).subscriptions).toHaveLength(0);
    const lock = new SessionLock(); const { token } = lock.unlock('alice'); const admission = lock.admission(lock.admit(token, 'alice'));
    expect((await handlePushRequest(request('subscribe', subscription), runtime, 'alice', admission))?.status).toBe(201);
    expect((await handlePushRequest(request('test-send', { endpoint: subscription.endpoint }), runtime, 'alice', admission))?.status).toBe(200);
    expect(sent).toHaveLength(1);
    lock.lock(token, 'alice');
    expect((await handlePushRequest(request('unsubscribe', { endpoint: subscription.endpoint }), runtime, 'alice', admission))?.status).toBe(423);
    expect((await store.load()).subscriptions).toHaveLength(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
