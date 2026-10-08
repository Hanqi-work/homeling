export interface SessionSnapshot {
  readonly locked: boolean;
  readonly ready?: boolean;
  readonly available?: boolean;
  readonly epoch?: number;
  readonly generation?: string;
  readonly idleDeadline?: number;
  readonly absoluteDeadline?: number;
  readonly serverNow?: number;
}
export class ClientSessionLocked extends Error {
  constructor() { super("session.locked"); }
}
export class SessionStateStore {
  private snapshot: SessionSnapshot = { locked: true, ready: false };
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  get = (): SessionSnapshot => this.snapshot;
  version = (): number => this.revision;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(): void { for (const listener of this.listeners) listener(); }
  apply(next: SessionSnapshot): void {
    const changed = next.epoch !== this.snapshot.epoch || next.generation !== this.snapshot.generation || next.locked !== this.snapshot.locked;
    if (changed) this.revision++;
    this.snapshot = { ...next, ready: !next.locked && !changed && this.snapshot.ready === true };
    this.emit();
  }
  lock(): void {
    this.revision++;
    this.snapshot = { ...this.snapshot, locked: true, ready: false }; this.emit();
  }
  caughtUp(): void {
    if (this.snapshot.locked) return;
    this.snapshot = { ...this.snapshot, ready: true }; this.emit();
  }
  admit = (): (() => void) => {
    const revision = this.revision;
    const check = () => { if (this.snapshot.locked || !this.snapshot.ready || revision !== this.revision) throw new ClientSessionLocked(); };
    check(); return check;
  };
}
export const sessionState = new SessionStateStore();
