/**
 * Parsers for the canary invariant checks (scripts/canary.sh does the shelling out; these
 * functions are the testable core). Keeping them in the daemon package means CI exercises
 * the exact same parsing the deploy-time script relies on.
 */

/** Extract the Proxy target of the `/` handler from `tailscale serve status --json`. */
export function parseServeStatusRootProxy(json: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json);
    const web = (parsed as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web;
    if (!web || typeof web !== "object") return null;
    for (const listener of Object.values(web)) {
      const proxy = listener?.Handlers?.["/"]?.Proxy;
      if (typeof proxy === "string" && proxy.length > 0) return proxy;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse `git status --porcelain` into non-empty lines. Empty array means a clean checkout. */
export function parseGitStatusPorcelain(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
