import type { SnapshotResponse } from "@homeling/contracts";

/** Same-origin `/api/*` lives at the Collie root, not under the `/lite` mount. */
export async function fetchSnapshot(signal?: AbortSignal): Promise<SnapshotResponse> {
  const res = await fetch("/api/snapshot", { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`/api/snapshot ${res.status}`);
  return (await res.json()) as SnapshotResponse;
}
