import type { ApprovalResponse } from "./api.ts";

/** Coalesces concurrent taps and permanently locks a control after a terminal/uncertain result. */
export function createSingleFlightApproval(
  approve: (optionId: string) => Promise<ApprovalResponse>,
): (optionId: string) => Promise<ApprovalResponse | null> {
  let inFlight = false;
  let settled = false;
  return async (optionId) => {
    if (inFlight || settled) return null;
    inFlight = true;
    try {
      const result = await approve(optionId);
      if (result.status !== "pending" || result.outcome === "already-handled" ||
          result.outcome === "unknown" || result.outcome === "stale") {
        settled = true;
      }
      return result;
    } catch (error) {
      settled = true;
      throw error;
    } finally {
      inFlight = false;
    }
  };
}
