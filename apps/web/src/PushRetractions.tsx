import { useEffect } from 'react';
import { startAbortableSerialPolling } from './polling.ts';
import { postPushRetractions, pushApi, type PushStatus } from './push-client.ts';

/** Read-only local notification cleanup. It never renews a lease or sends a silent Web Push. */
export function PushRetractions() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let reported = false;
    const polling = startAbortableSerialPolling(async signal => {
      try {
        const worker = await navigator.serviceWorker.getRegistration('/lite/');
        if (!worker || signal.aborted) return;
        const status = await pushApi<PushStatus>('status', undefined, signal);
        if (!signal.aborted) postPushRetractions(worker, status, window.location.origin);
      } catch {
        // Missing configuration, offline state or an old worker leave displayed notifications alone.
        if (!signal.aborted && !reported) { console.info('[homeling] local notification cleanup unavailable'); reported = true; }
      }
    }, 3000);
    return () => polling.stop();
  }, []);
  return null;
}
