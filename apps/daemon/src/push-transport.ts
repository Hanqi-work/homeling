import webpush from 'web-push';
import { mkdir, open, writeFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { createECDH, ECDH } from 'node:crypto';
import type { PushTransport } from './push-output.ts';

export interface VapidKeys { readonly publicKey: string; readonly privateKey: string }
export async function loadOrCreateVapid(path: string): Promise<VapidKeys> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(path));
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) throw new Error('unsafe VAPID directory');
  try {
    await writeFile(path, JSON.stringify(webpush.generateVAPIDKeys()), { flag: 'wx', mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let keys: VapidKeys;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > 1024) throw new Error('unsafe VAPID file');
    keys = JSON.parse(await file.readFile('utf8')) as VapidKeys;
  } finally { await file.close(); }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
  if (ecdh.getPublicKey().toString('base64url') !== keys.publicKey) throw new Error('invalid VAPID pair');
  return keys;
}
// Constrain authenticated enrollment too: arbitrary HTTPS URLs must not become an SSRF sender.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
export function validatePushSubscription(value: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!value || typeof value !== 'object') return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !PUSH_HOSTS.includes(url.hostname)) return null;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth)) return null;
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) return null;
  try { ECDH.convertKey(Buffer.from(keys.p256dh, 'base64url'), 'prime256v1'); } catch { return null; }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
export function createWebPushTransport(keys: VapidKeys, subject: string, send: typeof webpush.sendNotification = webpush.sendNotification): PushTransport {
  if (!/^(mailto:[^\s]+@[^\s]+|https:\/\/[^\s]+)$/.test(subject)) throw new Error('HOMELING_PUSH_SUBJECT must be a mailto or HTTPS contact');
  return {
    async send(subscription, payload) {
      if (!validatePushSubscription(subscription)) return { status: 'invalid' };
      try {
        await send(subscription, JSON.stringify(payload), { vapidDetails: { ...keys, subject }, contentEncoding: 'aes128gcm', TTL: 120, timeout: 10_000 });
        return { status: 'sent' };
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        return { status: statusCode === 404 || statusCode === 410 ? 'invalid' : 'failed', ...(statusCode === undefined ? {} : { statusCode }) };
      }
    },
  };
}
