import { test, expect } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import { loadOrCreateVapid, createWebPushTransport, validatePushSubscription } from './push-transport.ts';

test('daemon generates independent VAPID once, reloads it, sends via injectable real adapter boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-vapid-'));
  try {
    const path = join(dir, 'vapid.json');
    const keys = await loadOrCreateVapid(path);
    expect(await loadOrCreateVapid(path)).toEqual(keys);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    let options: unknown;
    const transport = createWebPushTransport(keys, 'mailto:test@example.com', async (subscription, payload, opts) => {
      options = opts;
      const request = webpush.generateRequestDetails(subscription, payload ?? undefined, opts);
      expect(request.headers['Content-Encoding']).toBe('aes128gcm');
      expect(request.headers.Authorization).toContain(`k=${keys.publicKey}`);
      expect(request.body?.toString()).not.toContain('具体问题');
      return { statusCode: 201, body: '', headers: {} };
    });
    const client = createECDH('prime256v1'); client.generateKeys();
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: client.getPublicKey().toString('base64url'), auth: Buffer.alloc(16).toString('base64url') }, owner: 'alice' };
    expect(await transport.send(subscription, { version: 1, type: 'notification', title: 'Homeling', body: '具体问题', tag: 'test', url: '/lite/', occurrenceKey: 'test' })).toEqual({ status: 'sent' });
    expect(options).toMatchObject({ vapidDetails: { ...keys, subject: 'mailto:test@example.com' }, contentEncoding: 'aes128gcm', TTL: 120, timeout: 10000 });
    expect(validatePushSubscription({ endpoint: 'https://127.0.0.1/admin', keys: { p256dh: 'x', auth: 'y' } })).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
