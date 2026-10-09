import { lockedResponse, SessionLocked, type MutationAdmission } from './session-lock.ts';
import type { PushPersistence } from './push-store.ts';
import { sendPushTest, type PushTransport } from './push-output.ts';
import { validatePushSubscription } from './push-transport.ts';

export interface PushApiRuntime { readonly store: PushPersistence; readonly publicKey: string; readonly transport: PushTransport }
const noStore = { 'cache-control': 'no-store' };
class PushBodyTooLarge extends Error {}
async function readPushBody(req: Request): Promise<string> {
  if (Number(req.headers.get('content-length')) > 8192) throw new PushBodyTooLarge();
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) throw new PushBodyTooLarge();
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => undefined); }
}
export async function handlePushRequest(req: Request, runtime: PushApiRuntime, owner: string, admission?: MutationAdmission): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith('/lite/api/push/')) return null;
  if (req.method === 'GET' && path === '/lite/api/push/status') {
    const state = await runtime.store.load();
    const retractTags = [...new Set([...Object.values(state.pendingOccurrences).filter(item => !item.active).map(item => `homeling-request-${item.occurrenceKey}`), ...state.retractTags])];
    return Response.json({ publicKey: runtime.publicKey, preferences: state.preferences, retractTags, subscriptions: state.subscriptions.filter(s => s.owner === owner).map(s => ({ endpoint: s.endpoint })) }, { headers: noStore });
  }
  if (req.method !== 'POST' || !['subscribe', 'unsubscribe', 'preferences', 'test-send'].some(action => path === `/lite/api/push/${action}`)) return Response.json({ error: 'method or route not allowed' }, { status: 405, headers: noStore });
  try {
    if (!admission || 'scope' in admission) return lockedResponse();
    admission.assert();
    if (req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return Response.json({ error: 'application/json required' }, { status: 415 });
    let body: Record<string, unknown>;
    try { body = JSON.parse(await readPushBody(req)); }
    catch (error) { return Response.json({ error: error instanceof PushBodyTooLarge ? 'body too large' : 'invalid JSON' }, { status: error instanceof PushBodyTooLarge ? 413 : 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'invalid body' }, { status: 400 });
    admission.assert();
    if (path.endsWith('/subscribe')) {
      const subscription = validatePushSubscription(body);
      if (!subscription) return Response.json({ error: 'unsupported or invalid push subscription' }, { status: 400 });
      await runtime.store.mutate(state => {
        const existing = state.subscriptions.find(s => s.endpoint === subscription.endpoint);
        if (existing && existing.owner !== owner) throw new Error('subscription belongs to another identity');
        if (state.subscriptions.length >= 100 && !existing) throw new Error('subscription limit reached');
        return { next: { ...state, subscriptions: [...state.subscriptions.filter(s => s.endpoint !== subscription.endpoint), { ...subscription, owner }] }, result: undefined };
      }, admission);
      return Response.json({ ok: true }, { status: 201, headers: noStore });
    }
    if (path.endsWith('/preferences')) {
      if (typeof body.enabled !== 'boolean') return Response.json({ error: 'enabled required' }, { status: 400 });
      const enabled = body.enabled;
      await runtime.store.mutate(state => ({ next: { ...state, preferences: { enabled } }, result: undefined }), admission);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (typeof body.endpoint !== 'string') return Response.json({ error: 'endpoint required' }, { status: 400 });
    if (path.endsWith('/unsubscribe')) {
      await runtime.store.mutate(state => ({ next: { ...state, subscriptions: state.subscriptions.filter(s => s.endpoint !== body.endpoint || s.owner !== owner) }, result: undefined }), admission);
      return Response.json({ ok: true }, { headers: noStore });
    }
    const result = await sendPushTest(runtime.store, runtime.transport, body.endpoint, owner, admission);
    return Response.json(result, { status: result.status === 'sent' ? 200 : 502, headers: noStore });
  } catch (error) {
    if (error instanceof SessionLocked) return lockedResponse();
    return Response.json({ error: 'push operation failed' }, { status: 502, headers: noStore });
  }
}
