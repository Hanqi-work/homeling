import type { SnapshotResponse } from '@homeling/contracts';
import { proxyTargetUrl, type BridgeFetch } from './bridge-proxy.ts';
import type { DaemonConfig } from './config.ts';
import type { PersonaRegistry } from './persona-registry.ts';
import type { PendingPushObservation } from './push-pending.ts';
import { detectPendingRequest, readPaneText } from './requests.ts';

export interface PushTaskOwnership { readonly personaId: string; readonly spaceId: string; readonly paneId: string; readonly occurrenceKey: string }
export type PushTaskOwnershipProvider = () => Promise<readonly PushTaskOwnership[]>;
export interface PendingPushBatch {
  readonly validBindings: ReadonlySet<string>;
  readonly observations: readonly PendingPushObservation[];
}
/** Current approval observations only; never converts snapshots into task Activity history. */
export async function readPendingPushBatch(cfg: DaemonConfig, fetcher: BridgeFetch, registry: PersonaRegistry, ownership: PushTaskOwnershipProvider): Promise<PendingPushBatch> {
  const response = await fetcher(proxyTargetUrl('/lite/api/snapshot', cfg), { method: 'GET', redirect: 'manual' });
  if (!response.ok) throw new Error('push observation unavailable');
  const snapshot = await response.json() as SnapshotResponse;
  if (snapshot.bridge !== 'connected') throw new Error('push observation disconnected');
  // Project trusted ownership once, after the snapshot await; retirement and panes share it.
  const personas = await registry.list();
  const latestTasks = new Map((await ownership()).map(item => [item.paneId, item]));
  const bindings = new Map<string, { binding: string; personaName: string; spaceId: string; url: string }>();
  const validBindings = new Set<string>();
  for (const persona of personas) {
    const binding = `main:${persona.id}:${persona.spaceId}:${persona.mainPaneId}`;
    validBindings.add(binding);
    bindings.set(persona.mainPaneId, { binding, personaName: persona.name, spaceId: persona.spaceId, url: `/lite/persona/${encodeURIComponent(persona.id)}` });
  }
  for (const task of latestTasks.values()) {
    bindings.delete(task.paneId);
    const persona = personas.find(item => item.id === task.personaId && item.spaceId === task.spaceId);
    if (!persona) continue;
    const binding = `task:${task.occurrenceKey}`;
    validBindings.add(binding);
    bindings.set(task.paneId, { binding, personaName: persona.name, spaceId: task.spaceId, url: `/lite/p/${encodeURIComponent(task.paneId)}?occurrence=${encodeURIComponent(task.occurrenceKey)}` });
  }
  const observations: PendingPushObservation[] = [];
  for (const pane of snapshot.agents) {
    const owner = bindings.get(pane.paneId);
    if (!owner || owner.spaceId !== pane.workspaceId) continue;
    const { binding, personaName, url } = owner;
    if (pane.status === 'unknown') { observations.push({ binding, state: 'unknown' }); continue; }
    if (pane.status !== 'blocked') { observations.push({ binding, state: 'resolved' }); continue; }
    try {
      const text = await readPaneText(cfg, fetcher, pane.paneId, null);
      const detected = detectPendingRequest(text);
      if (!detected) continue; // An unrecognized screen is not proof of resolution.
      const specific = detected.kind === 'preview-select' ? detected.preview.join(' ') : detected.subject.join(' ');
      if (!specific.trim()) continue; // Do not send a generic permission title without the operation.
      const summary = `需要你批准 ${specific.replace(/\s+/g, ' ').trim()}`;
      // Ignore pointer movement / terminal context redraw, but bind concrete operation+options.
      const identity = JSON.stringify({ kind: detected.kind, question: detected.question, subject: detected.subject.join(' '), options: detected.options.map(o => ({ id: o.id, label: o.label })) });
      observations.push({ state: 'pending', binding, personaName, url, identity, summary, bodyTemplate: { key: 'push.approval', params: { question: specific.replace(/\s+/g, ' ').trim() } } });
    } catch { /* Gap leaves durable pending occurrence untouched; next successful read reconciles. */ }
  }
  return { validBindings, observations };
}
