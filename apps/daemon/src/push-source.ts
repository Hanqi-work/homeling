import type { SnapshotResponse } from '@homeling/contracts';
import { detectPendingRequest } from './requests.ts';
import { proxyTargetUrl, type BridgeFetch } from './bridge-proxy.ts';
import type { DaemonConfig } from './config.ts';
import type { PersonaRegistry } from './persona-registry.ts';
import type { PendingPushObservation } from './push-pending.ts';

export interface PushTaskOwnership { readonly personaId: string; readonly spaceId: string; readonly paneId: string; readonly occurrenceKey: string }
export type TaskOwnershipLookup = (paneId: string) => Promise<PushTaskOwnership | undefined>;
/** Current approval observations only; never converts snapshots into task Activity history. */
export async function readPendingPushObservations(cfg: DaemonConfig, fetcher: BridgeFetch, registry: PersonaRegistry, ownership: TaskOwnershipLookup): Promise<readonly PendingPushObservation[]> {
  const response = await fetcher(proxyTargetUrl('/lite/api/snapshot', cfg), { method: 'GET', redirect: 'manual' });
  if (!response.ok) throw new Error('push observation unavailable');
  const snapshot = await response.json() as SnapshotResponse;
  if (snapshot.bridge !== 'connected') throw new Error('push observation disconnected');
  const personas = await registry.list();
  const observations: PendingPushObservation[] = [];
  for (const pane of snapshot.agents) {
    const taskOwner = await ownership(pane.paneId);
    const persona = taskOwner ? personas.find(p => p.id === taskOwner.personaId && p.spaceId === taskOwner.spaceId) : personas.find(p => p.mainPaneId === pane.paneId && p.spaceId === pane.workspaceId);
    if (!persona || persona.spaceId !== pane.workspaceId) continue;
    const common = { binding: taskOwner ? `task:${taskOwner.occurrenceKey}` : `main:${persona.id}:${persona.spaceId}:${persona.mainPaneId}`, personaId: persona.id, personaName: persona.name, paneId: pane.paneId, task: Boolean(taskOwner), identity: '', summary: '' };
    if (pane.status === 'unknown') { observations.push({ ...common, state: 'unknown' }); continue; }
    if (pane.status !== 'blocked') { observations.push({ ...common, state: 'resolved' }); continue; }
    try {
      const screen = await fetcher(proxyTargetUrl(`/lite/api/pane/${encodeURIComponent(pane.paneId)}`, cfg), { method: 'GET', redirect: 'manual' });
      if (!screen.ok) continue;
      const raw = await screen.json() as { text?: unknown; truncated?: unknown };
      if (typeof raw.text !== 'string' || raw.truncated === true) continue;
      const detected = detectPendingRequest(raw.text);
      if (!detected) continue; // An unrecognized screen is not proof of resolution.
      const specific = detected.kind === 'preview-select' ? detected.preview.join(' ') : detected.subject.join(' ');
      if (!specific.trim()) continue; // Do not send a generic permission title without the operation.
      const summary = `需要你批准 ${specific.replace(/\s+/g, ' ').trim()}`;
      // Ignore pointer movement / terminal context redraw, but bind concrete operation+options.
      const identity = JSON.stringify({ kind: detected.kind, question: detected.question, subject: specific, options: detected.options.map(o => ({ id: o.id, label: o.label })) });
      observations.push({ ...common, state: 'pending', identity, summary });
    } catch { /* Gap leaves durable pending occurrence untouched; next successful read reconciles. */ }
  }
  return observations;
}
