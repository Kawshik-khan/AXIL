/**
 * In-process operational signals for the monitoring job (production readiness O6): unhandled server errors are
 * counted here as they happen, and the monitoring job reads the count for its window.
 *
 * Per server process. Production runs one instance (render.yaml); with several, each server counts its own errors and
 * the monitoring job sees only the server it runs on.
 */

const MAX_TRACKED = 1000;
const serverErrorTimes: number[] = [];

/** Called for every unhandled error answered with a generic 500 (`apiError`). */
export function recordServerError(now = Date.now()): void {
  serverErrorTimes.push(now);
  if (serverErrorTimes.length > MAX_TRACKED) serverErrorTimes.splice(0, serverErrorTimes.length - MAX_TRACKED);
}

/** Unhandled server errors since `sinceMs` (capped at the last 1000). */
export function serverErrorsSince(sinceMs: number): number {
  let n = 0;
  for (let i = serverErrorTimes.length - 1; i >= 0 && serverErrorTimes[i] >= sinceMs; i--) n++;
  return n;
}

export function resetOpsSignalsForTesting(): void {
  serverErrorTimes.length = 0;
}
