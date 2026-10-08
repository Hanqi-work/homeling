import { useEffect, useState } from 'react';
import { enablePush, pushApi, type PushStatus } from './push-client.ts';
import { ClientSessionLocked, sessionState } from './session-state.ts';
import { resolveLocale } from '@homeling/contracts';
import { useLocale } from './locale.tsx';
import { LocalizedUIError, type LocalizedCopy } from './ui-copy.ts';

export function PushSettings() {
  const { t, locale, observePushLocale, acknowledgePushLocale, getPushLocaleRevision } = useLocale();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<LocalizedCopy | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const refresh = async () => setStatus(await pushApi<PushStatus>('status'));
  useEffect(() => {
    if (!supported) return;
    let active = true;
    const localeRevision = getPushLocaleRevision();
    void (async () => {
      try {
        // Exact registration, not navigator.serviceWorker.ready (which could return Collie's root worker).
        const worker = await navigator.serviceWorker.getRegistration('/lite/');
        if (!worker || new URL(worker.scope).pathname !== '/lite/' || !worker.active) throw new LocalizedUIError('通知服务尚未就绪，请刷新后重试。', { key: 'push.workerNotReady' });
        const [next, current] = await Promise.all([pushApi<PushStatus>('status'), worker.pushManager.getSubscription()]);
        if (active) {
          setRegistration(worker); setStatus(next); setSubscription(current);
          const stored = current ? next.subscriptions.find(item => item.endpoint === current.endpoint) : undefined;
          if (!current) observePushLocale(undefined, localeRevision);
          else if (stored) observePushLocale(resolveLocale(stored.locale), localeRevision);
        }
      } catch (err) { if (active) setError(err instanceof LocalizedUIError ? err.copy : { key: 'push.loadFailed', params: { error: err instanceof Error ? err.message : '' } }); }
    })();
    return () => { active = false; };
  }, [supported]);
  const act = async (operation: (admission: () => void) => Promise<void>) => {
    setBusy(true); setError(null);
    try { const admission = sessionState.admit(); await operation(admission); await refresh(); }
    catch (err) { setError(err instanceof ClientSessionLocked ? { key: 'push.unlockRequired' } : err instanceof LocalizedUIError ? err.copy : { key: 'push.operationError', params: { error: err instanceof Error ? err.message : '' } }); }
    finally { setBusy(false); }
  };
  const connected = Boolean(subscription && status?.subscriptions.some(s => s.endpoint === subscription.endpoint));
  const button = 'min-h-12 rounded-xl border border-neutral-700 px-4 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300';
  return <section aria-labelledby="push-settings-title" className="rounded-2xl bg-neutral-900 p-4">
    <h2 id="push-settings-title" className="font-semibold">{t("push.settingsTitle")}</h2>
    <p className="mt-2 text-sm text-neutral-400">{t("push.settingsHint")}</p>
    {!supported ? <p role="status" className="mt-3 text-sm text-neutral-300">{t("push.unsupportedBrowser")}</p> : <>
      <p className="mt-3 text-sm" role="status">{connected ? t("push.deviceSubscribed") : t("push.deviceNotSubscribed")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={button} disabled={busy || !registration || !status} onClick={() => {
          // Permission prompt starts synchronously within this explicit gesture, before async API calls.
          void act(async (admission) => {
            if (await Notification.requestPermission() !== 'granted') throw new LocalizedUIError('通知权限未允许。请在系统设置中允许通知后重试。', { key: 'push.permissionDenied' });
            admission();
            setSubscription(await enablePush(registration!, status!.publicKey, undefined, admission, locale));
            acknowledgePushLocale(locale);
          });
        }}>{connected ? t("push.reconnect") : t("push.enable")}</button>
        <button className={button} disabled={busy || !subscription} onClick={() => void act(async (admission) => {
          await pushApi('unsubscribe', { endpoint: subscription!.endpoint });
          admission();
          if (!await subscription!.unsubscribe()) throw new LocalizedUIError('浏览器取消订阅未成功，可重试。', { key: 'push.unsubscribeFailed' });
          setSubscription(null);
        })}>{t("push.unsubscribe")}</button>
        <button className={button} disabled={busy || !connected} onClick={() => void act(async () => { await pushApi('test-send', { endpoint: subscription!.endpoint }); })}>{t("push.testSend")}</button>
      </div>
      <label className="mt-4 flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={status?.preferences.enabled ?? false} disabled={busy || !status} onChange={event => { const enabled = event.currentTarget.checked; void act(async () => { await pushApi('preferences', { enabled }); }); }} />{t("push.masterEnabled")}</label>
    </>}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{t(error.key, { ...error.params, error: error.params?.error || t("common.unknownError") })}</p> : null}
  </section>;
}
