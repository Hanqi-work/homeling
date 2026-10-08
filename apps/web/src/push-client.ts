export interface PushStatus { readonly publicKey: string; readonly preferences: { readonly enabled: boolean }; readonly subscriptions: readonly { readonly endpoint: string }[] }
export async function pushApi<T>(action: string, body?: unknown): Promise<T> {
  const response = await fetch(`/lite/api/push/${action}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 423 ? '请先解锁 Homeling，再修改通知设置。' : `通知操作失败 (${response.status})`);
  return response.json() as Promise<T>;
}
export function vapidBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export async function enablePush(registration: ServiceWorkerRegistration, publicKey: string, enroll: (body: unknown) => Promise<unknown> = body => pushApi('subscribe', body)): Promise<PushSubscription> {
  if (new URL(registration.scope).pathname !== '/lite/') throw new Error('Homeling notifications require the /lite/ worker');
  let subscription = await registration.pushManager.getSubscription();
  const created = !subscription;
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey) });
  try { await enroll(subscription.toJSON()); }
  catch (error) {
    if (created) await subscription.unsubscribe();
    throw error;
  }
  return subscription;
}
