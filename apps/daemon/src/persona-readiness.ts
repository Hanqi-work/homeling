import { HerdrRpcError, type HerdrPort } from "./herdr-client.ts";

export interface PaneReadyOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly floorMs?: number;
  readonly ceilingMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait for a non-empty pane screen to remain stable before typing into the new shell. */
export async function awaitPaneReady(
  herdr: HerdrPort,
  paneId: string,
  options: PaneReadyOptions = {},
): Promise<{ ready: boolean; ms: number }> {
  const pause = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? 150;
  const floorMs = options.floorMs ?? 300;
  const ceilingMs = options.ceilingMs ?? 5_000;
  const started = now();
  let previous: string | null = null;
  for (;;) {
    await pause(pollMs);
    let current: string | null = null;
    try { current = await herdr.readPane(paneId, 40); } catch { /* unreadable means not ready */ }
    const elapsed = now() - started;
    if (current !== null && current.trim() !== "" && current === previous && elapsed >= floorMs) {
      return { ready: true, ms: elapsed };
    }
    previous = current;
    if (elapsed >= ceilingMs) return { ready: false, ms: elapsed };
  }
}

export async function awaitAgentReady(
  herdr: HerdrPort,
  paneId: string,
  options: { readonly sleep?: (ms: number) => Promise<void>; readonly now?: () => number; readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<void> {
  const pause = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 200;
  let lastError: unknown;
  for (;;) {
    try {
      const snapshot = await herdr.snapshot();
      if (snapshot.agents.some((agent) => agent.pane_id === paneId)) return;
    } catch (error) {
      lastError = error;
    }
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      if (lastError instanceof HerdrRpcError) {
        throw new HerdrRpcError(lastError.code, `Agent did not become ready in ${timeoutMs}ms: ${lastError.message}`);
      }
      throw new HerdrRpcError("herdr.agent_start_timeout", `Agent did not become ready in ${timeoutMs}ms`);
    }
    await pause(Math.min(pollMs, timeoutMs - elapsed));
  }
}
