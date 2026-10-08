import { test, expect } from 'bun:test';
import { mkdtemp, realpath, rm, stat, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import { loadOrCreateVapid, createWebPushTransport, validatePushSubscription } from './push-transport.ts';
import { PushStore } from './push-store.ts';
import { createDaemonSystemAdmissions } from './system-admission.ts';

test('daemon generates independent VAPID once, reloads it, sends via injectable real adapter boundary', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-vapid-'));
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

test('VAPID and push store both reject an intermediate symlink before creating or reading files', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'homeling-private-'));
  try {
    const target = join(dir, 'target');
    const link = join(dir, 'link');
    await mkdir(target, { mode: 0o700 });
    const directory = join(link, 'nested', 'private');
    const cachedStore = new PushStore(join(directory, 'push.json'));
    await cachedStore.load();
    await symlink(target, link);
    await expect(cachedStore.mutate(state => ({ next: { ...state, preferences: { enabled: false } }, result: undefined }), createDaemonSystemAdmissions().pushDeliver)).rejects.toThrow('unsafe push directory ancestor');
    await expect(loadOrCreateVapid(join(directory, 'vapid.json'))).rejects.toThrow('unsafe push directory ancestor');
    const store = new PushStore(join(directory, 'push.json'));
    await expect(store.load()).rejects.toThrow('unsafe push directory ancestor');
    await expect(store.mutate(state => ({ next: { ...state, preferences: { enabled: false } }, result: undefined }), createDaemonSystemAdmissions().pushDeliver)).rejects.toThrow('unsafe push directory ancestor');
    expect(await readdir(target)).toEqual([]);
    // Generate only disposable test keys, then prove an existing safe leaf cannot hide the link.
    const canonicalDirectory = join(target, 'nested', 'private');
    await loadOrCreateVapid(join(canonicalDirectory, 'vapid.json'));
    const canonicalStore = new PushStore(join(canonicalDirectory, 'push.json'));
    await canonicalStore.mutate(state => ({ next: { ...state, preferences: { enabled: false } }, result: undefined }), createDaemonSystemAdmissions().pushDeliver);
    await expect(loadOrCreateVapid(join(directory, 'vapid.json'))).rejects.toThrow('unsafe push directory ancestor');
    await expect(new PushStore(join(directory, 'push.json')).load()).rejects.toThrow('unsafe push directory ancestor');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
