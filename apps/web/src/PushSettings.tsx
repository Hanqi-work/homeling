import { useEffect, useState } from 'react';
import { enablePush, pushApi, type PushStatus } from './push-client.ts';

export function PushSettings() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const refresh = async () => setStatus(await pushApi<PushStatus>('status'));
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void (async () => {
      try {
        // Exact registration, not navigator.serviceWorker.ready (which could return Collie's root worker).
        const worker = await navigator.serviceWorker.getRegistration('/lite/');
        if (!worker || new URL(worker.scope).pathname !== '/lite/' || !worker.active) throw new Error('通知服务尚未就绪，请刷新后重试。');
        const [next, current] = await Promise.all([pushApi<PushStatus>('status'), worker.pushManager.getSubscription()]);
        if (active) { setRegistration(worker); setStatus(next); setSubscription(current); }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : '无法加载通知设置。'); }
    })();
    return () => { active = false; };
  }, [supported]);
  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : '通知操作失败。'); }
    finally { setBusy(false); }
  };
  const connected = Boolean(subscription && status?.subscriptions.some(s => s.endpoint === subscription.endpoint));
  const button = 'min-h-12 rounded-xl border border-neutral-700 px-4 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300';
  return <section aria-labelledby="push-settings-title" className="rounded-2xl bg-neutral-900 p-4">
    <h2 id="push-settings-title" className="font-semibold">Homeling 通知</h2>
    <p className="mt-2 text-sm text-neutral-400">审批问题、任务完成或失败会发送到此设备。Collie 通知保持不变；锁屏可显示具体问题，请留意隐私。</p>
    {!supported ? <p role="status" className="mt-3 text-sm text-neutral-300">此浏览器不支持 Web Push。iPhone/iPad 请先添加到主屏幕，再打开并允许通知。</p> : <>
      <p className="mt-3 text-sm" role="status">{connected ? '此设备已订阅' : '此设备未订阅'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={button} disabled={busy || !registration || !status} onClick={() => {
          // Permission prompt starts synchronously within this explicit gesture, before async API calls.
          const permission = Notification.requestPermission();
          void act(async () => {
            if (await permission !== 'granted') throw new Error('通知权限未允许。请在系统设置中允许通知后重试。');
            setSubscription(await enablePush(registration!, status!.publicKey));
          });
        }}>{connected ? '重新连接通知' : '允许并订阅'}</button>
        <button className={button} disabled={busy || !subscription} onClick={() => void act(async () => {
          await pushApi('unsubscribe', { endpoint: subscription!.endpoint });
          if (!await subscription!.unsubscribe()) throw new Error('浏览器取消订阅未成功，可重试。');
          setSubscription(null);
        })}>取消此设备订阅</button>
        <button className={button} disabled={busy || !connected} onClick={() => void act(async () => { await pushApi('test-send', { endpoint: subscription!.endpoint }); })}>发送测试通知</button>
      </div>
      <label className="mt-4 flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={status?.preferences.enabled ?? false} disabled={busy || !status} onChange={event => { const enabled = event.currentTarget.checked; void act(async () => { await pushApi('preferences', { enabled }); }); }} />启用既定通知（所有已订阅设备）</label>
    </>}
    {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
  </section>;
}
