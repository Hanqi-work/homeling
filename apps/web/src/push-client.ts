import { sessionMutationFetch } from './api.ts';
import { sessionState } from './session-state.ts';
import { isLocale, resolveLocale, type Locale } from '@homeling/contracts';
import { LocalizedUIError } from './ui-copy.ts';

export interface PushStatus { readonly publicKey: string; readonly preferences: { readonly enabled: boolean }; readonly subscriptions: readonly { readonly endpoint: string; readonly locale?: Locale }[]; readonly retractTags?: readonly string[] }
export async function pushApi<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  if (body === undefined) response = await fetch(`/lite/api/push/${action}`, { cache: 'no-store', signal });
  else {
    const proof = sessionState.get();
    if (!Number.isSafeInteger(proof.epoch) || !proof.generation) throw new LocalizedUIError('session.locked', { key: 'push.unlockRequired' });
    response = await sessionMutationFetch(`/lite/api/push/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-homeling-session-epoch': String(proof.epoch), 'x-homeling-session-generation': proof.generation }, body: JSON.stringify(body), signal });
  }
  if (!response.ok) throw new LocalizedUIError(response.status === 423 ? '请先解锁 Homeling，再修改通知设置。' : `通知操作失败 (${response.status})`, { key: response.status === 423 ? 'push.unlockRequired' : 'push.operationFailed', params: { status: response.status } });
  return response.json() as Promise<T>;
}
export interface PushLocaleDependencies {
  origin(): string;
  getRegistration(): Promise<ServiceWorkerRegistration | undefined>;
  getStatus(): Promise<PushStatus>;
  update(endpoint: string, locale: Locale): Promise<{ ok: boolean; locale?: Locale }>;
}
const browserLocaleDependencies: PushLocaleDependencies = {
  origin: () => window.location.origin,
  getRegistration: async () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration('/lite/') : undefined,
  getStatus: () => pushApi<PushStatus>('status'),
  update: (endpoint, locale) => pushApi('locale', { endpoint, locale }),
};
/** No permission request, enrollment, test notification or retry: only an existing owned endpoint's metadata. */
export async function syncPushLocale(locale: Locale, check: () => void, dependencies: PushLocaleDependencies = browserLocaleDependencies): Promise<'synced' | 'not-subscribed'> {
  check();
  const worker = await dependencies.getRegistration();
  check();
  if (!worker) return 'not-subscribed';
  const scope = new URL(worker.scope);
  if (scope.origin !== dependencies.origin() || scope.pathname !== '/lite/' || !worker.active) throw new LocalizedUIError('Homeling notifications require the active /lite/ worker', { key: 'push.workerNotReady' });
  if (!worker.pushManager?.getSubscription) return 'not-subscribed';
  const subscription = await worker.pushManager.getSubscription();
  check();
  if (!subscription) return 'not-subscribed';
  const status = await dependencies.getStatus();
  check();
  const existing = status.subscriptions.find(item => item.endpoint === subscription.endpoint);
  if (!existing) throw new LocalizedUIError('Current browser subscription is not registered for this identity', { key: 'push.localeMissing' });
  if (resolveLocale(existing.locale) === locale) return 'synced';
  const result = await dependencies.update(subscription.endpoint, locale);
  check();
  if (result.ok !== true || !isLocale(result.locale) || result.locale !== locale) throw new LocalizedUIError('Notification language update could not be confirmed', { key: 'push.localeUnsynced' });
  return 'synced';
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
export async function enablePush(registration: ServiceWorkerRegistration, publicKey: string, enroll: (body: unknown) => Promise<unknown> = body => pushApi('subscribe', body), admission?: () => void, locale?: Locale): Promise<PushSubscription> {
  if (new URL(registration.scope).pathname !== '/lite/') throw new LocalizedUIError('Homeling notifications require the /lite/ worker', { key: 'push.workerNotReady' });
  const check = admission ?? sessionState.admit();
  check();
  let subscription = await registration.pushManager.getSubscription();
  check();
  const created = !subscription;
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey) });
  try { check(); const body = subscription.toJSON(); await enroll(locale === undefined ? body : { ...body, locale }); }
  catch (error) {
    // Only this already-dispatched allocation is compensated; old existing subscriptions stay intact.
    if (created) await subscription.unsubscribe();
    throw error;
  }
  return subscription;
}
