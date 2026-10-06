/**
 * Provider-neutral resilience for model calls (AI fix plan FX-79, audit F10). Behaviour depends only on HTTP status and
 * the profile's settings, never on the vendor:
 * - 429 and 5xx: up to 3 retries, exponential backoff with full jitter (base 500 ms), honouring `retry-after`;
 * - 400: one retry (gpt-oss tool-call parse failures surface as 400 on OpenAI-compatible servers);
 * - other 4xx: no retry; a network timeout: one retry if the deadline allows;
 * - a FIFO concurrency limit per provider (LLM_MAX_CONCURRENCY), whose waiting counts against the deadline.
 * Every wait respects the caller's deadline: nothing sleeps past it.
 */
import { AppError } from "@/lib/errors";

export const LLM_BUSY = "LLM_BUSY";
export const LLM_DEADLINE = "LLM_DEADLINE_EXCEEDED";

/** `retry-after` as milliseconds: seconds, or an HTTP date. Undefined when absent or unreadable. */
export function retryAfterMs(header: string | string[] | undefined, now = Date.now()): number | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A FIFO semaphore; `acquire` gives up (LLM_BUSY) when no slot frees up before the deadline. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<{ grant: () => void; timer?: ReturnType<typeof setTimeout> }> = [];

  constructor(private readonly size: number) {}

  public get inUse(): number {
    return this.active;
  }

  public acquire(deadlineMs: number): Promise<() => void> {
    const release = () => {
      this.active--;
      const next = this.queue.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        this.active++;
        next.grant();
      }
    };
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve(once(release));
    }
    const wait = deadlineMs - Date.now();
    if (wait <= 0) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      const entry: { grant: () => void; timer?: ReturnType<typeof setTimeout> } = { grant: () => resolve(once(release)) };
      entry.timer = setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        reject(busy());
      }, wait);
      this.queue.push(entry);
    });
  }
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      fn();
    }
  };
}

const busy = () => new AppError(LLM_BUSY, "The AI provider is busy; no slot freed up in time.", 503);

export interface CallFailure {
  status?: number;
  retryAfterMs?: number;
  timedOut?: boolean;
}

/**
 * Runs `attempt` with the retry rules above. `classify` reads a thrown error; `timeoutFor` gives each attempt the time
 * left before the deadline. Throws the last error when retries run out, or LLM_DEADLINE when time does.
 */
export async function withRetries<T>(
  deadlineMs: number,
  attempt: (timeoutMs: number) => Promise<T>,
  classify: (err: unknown) => CallFailure,
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void
): Promise<T> {
  let backoffRetries = 0;
  let retried400 = false;
  let retriedTimeout = false;
  for (;;) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw new AppError(LLM_DEADLINE, "The AI call ran out of time.", 504);
    try {
      return await attempt(remaining);
    } catch (err) {
      const f = classify(err);
      let waitMs: number | undefined;
      let reason = "";
      if (f.status === 429 || (f.status !== undefined && f.status >= 500)) {
        if (backoffRetries < 3) {
          waitMs = f.retryAfterMs ?? Math.random() * 500 * 2 ** backoffRetries; // full jitter
          backoffRetries++;
          reason = `HTTP ${f.status}`;
        }
      } else if (f.status === 400 && !retried400) {
        retried400 = true;
        waitMs = 0;
        reason = "HTTP 400";
      } else if (f.timedOut && !retriedTimeout) {
        retriedTimeout = true;
        waitMs = 0;
        reason = "timeout";
      }
      if (waitMs === undefined || Date.now() + waitMs >= deadlineMs) throw err;
      onRetry?.({ attempt: backoffRetries, waitMs, reason });
      if (waitMs > 0) await sleep(waitMs);
    }
  }
}
