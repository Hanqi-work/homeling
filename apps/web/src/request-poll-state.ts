import type { PendingRequest } from "@homeling/contracts";

export interface RequestPollUpdate {
  readonly pending: PendingRequest[];
  /** A request that vanished from the pending feed gets a local terminal tombstone. */
  readonly settled: PendingRequest[];
}

/** Rejects stale poll responses and keeps settled IDs tombstoned for this pane's lifetime. */
export class RequestPollState {
  private generation = 0;
  private readonly tombstones = new Set<string>();
  private pending = new Map<string, PendingRequest>();

  begin(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  settle(id: string): void {
    this.tombstones.add(id);
    this.pending.delete(id);
    this.generation++;
  }

  accept(generation: number, requests: readonly PendingRequest[], paneId: string): RequestPollUpdate | null {
    if (!this.isCurrent(generation)) return null;
    const pending = requests.filter((request) =>
      request.paneId === paneId && !this.tombstones.has(request.id),
    );
    const nextIds = new Set(pending.map((request) => request.id));
    const disappeared = [...this.pending.values()]
      .filter((request) => !nextIds.has(request.id))
      .map((request) => ({ ...request, status: "resolved" as const }));
    for (const request of disappeared) this.tombstones.add(request.id);
    this.pending = new Map(pending.map((request) => [request.id, request]));
    return { pending, settled: disappeared };
  }
}
