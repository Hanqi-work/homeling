import { sessionMutationFetch } from './api.ts';
import { sessionState } from './session-state.ts';

export interface PushStatus { readonly publicKey: string; readonly preferences: { readonly enabled: boolean }; readonly subscriptions: readonly { readonly endpoint: string }[]; readonly retractTags?: readonly string[] }
export async function pushApi<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  if (body === undefined) response = await fetch(`/lite/api/push/${action}`, { cache: 'no-store', signal });
  else {
    const proof = sessionState.get();
    if (!Number.isSafeInteger(proof.epoch) || !proof.generation) throw new Error('session.locked');
    response = await sessionMutationFetch(`/lite/api/push/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-homeling-session-epoch': String(proof.epoch), 'x-homeling-session-generation': proof.generation }, body: JSON.stringify(body), signal });
  }
  if (!response.ok) throw new Error(response.status === 423 ? '请先解锁 Homeling，再修改通知设置。' : `通知操作失败 (${response.status})`);
  return response.json() as Promise<T>;
}
export function postPushRetractions(registration: ServiceWorkerRegistration, status: PushStatus, origin: string): number {
  const scope = new URL(registration.scope);
  if (scope.origin !== origin || scope.pathname !== '/lite/' || !registration.active) return 0;
  let count = 0;
  for (const tag of status.retractTags ?? []) {
    if (typeof tag !== 'string' || !tag.startsWith('homeling-')) continue;
    registration.active.postMessage({ type: 'HOMELING_RETRACT', tag }); count++;
  }
  return count;
}

export function vapidBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export async function enablePush(registration: ServiceWorkerRegistration, publicKey: string, enroll: (body: unknown) => Promise<unknown> = body => pushApi('subscribe', body), admission?: () => void): Promise<PushSubscription> {
  if (new URL(registration.scope).pathname !== '/lite/') throw new Error('Homeling notifications require the /lite/ worker');
  const check = admission ?? sessionState.admit();
  check();
  let subscription = await registration.pushManager.getSubscription();
  check();
  const created = !subscription;
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey) });
  try { check(); await enroll(subscription.toJSON()); }
  catch (error) {
    // Only this already-dispatched allocation is compensated; old existing subscriptions stay intact.
    if (created) await subscription.unsubscribe();
    throw error;
  }
  return subscription;
}
