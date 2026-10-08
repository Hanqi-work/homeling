import { test, expect } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateVapid, createWebPushTransport, validatePushSubscription } from './push-transport.ts';

test('daemon generates independent VAPID once, reloads it, sends via injectable real adapter boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'homeling-vapid-'));
  try {
    const path = join(dir, 'vapid.json');
    const keys = await loadOrCreateVapid(path);
    expect(await loadOrCreateVapid(path)).toEqual(keys);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    let options: unknown;
    const transport = createWebPushTransport(keys, 'mailto:test@example.com', async (_subscription, _payload, opts) => { options = opts; return { statusCode: 201, body: '', headers: {} }; });
    expect(await transport.send({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'x', auth: 'y' }, owner: 'alice' }, { version: 1, type: 'retract', tag: 'test' })).toEqual({ status: 'sent' });
    expect(options).toMatchObject({ vapidDetails: { ...keys, subject: 'mailto:test@example.com' }, contentEncoding: 'aes128gcm', TTL: 120, timeout: 10000 });
    expect(validatePushSubscription({ endpoint: 'https://127.0.0.1/admin', keys: { p256dh: 'x', auth: 'y' } })).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
