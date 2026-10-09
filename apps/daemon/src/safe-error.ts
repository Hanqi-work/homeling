/** Machine outcomes are allowlisted; upstream text/cause/headers are never diagnostics. */
const CODES = new Set([
  "herdr.timeout", "herdr.unavailable", "herdr.protocol", "herdr.rpc_error", "herdr.pane_not_ready", "herdr.agent_start_timeout", "pane_not_found",
  "stt.unconfigured", "prompt_changed", "prompt.read_failed", "prompt.not_found", "pane.not_found", "reply.failed", "launch.timeout", "bridge.unavailable",
]);
export function safeErrorCode(error: unknown, fallback: string): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && CODES.has(code) ? code : fallback;
}
/** Keep only delivery evidence; an HTTP failure without evidence remains uncertain. */
export function safeUpstreamFailure(value: unknown, message: string, fallback: string, uncertain: boolean): {
  ok: false; error: string; code: string;
  textDelivered?: boolean | null; deliveryUnknown?: boolean; executed?: boolean;
} {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const evidence: Record<string, boolean | null> = {};
  for (const key of ["textDelivered", "deliveryUnknown", "executed"] as const) {
    if (typeof result[key] === "boolean" || (key === "textDelivered" && result[key] === null)) evidence[key] = result[key] as boolean | null;
  }
  const notDispatched = evidence.executed === false && evidence.deliveryUnknown === false;
  if (uncertain && !notDispatched && evidence.textDelivered !== true && evidence.textDelivered !== false) evidence.deliveryUnknown = true;
  return { ok: false, error: message, code: safeErrorCode(result, fallback), ...evidence };
}
