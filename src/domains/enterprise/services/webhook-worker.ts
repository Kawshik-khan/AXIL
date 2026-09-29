/**
 * Runs the enterprise webhook outbox and delivery (FX-54) every few seconds in each app server. Several servers are
 * safe: each delivery is claimed in a unit of work before it is sent (ADR-109). Started from instrumentation once the
 * store is ready; `WEBHOOK_WORKER=0` turns it off (for example on a server that should only answer requests).
 */
import { logger } from "@/lib/logger";
import { webhookPlatformService } from "./webhook-platform.service";

const INTERVAL_MS = 5_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startWebhookWorker(): void {
  if (timer || process.env.WEBHOOK_WORKER === "0" || process.env.NEXT_PHASE === "phase-production-build") return;
  timer = setInterval(() => {
    if (running) return; // a slow receiver: never overlap passes
    running = true;
    webhookPlatformService
      .runOnce()
      .then((s) => {
        if (s.attempted || s.queued) logger.info("webhooks.worker_pass", { queued: s.queued, attempted: s.attempted, delivered: s.delivered, failed: s.failed });
      })
      .catch((err: unknown) => logger.warn("webhooks.worker_failed", { error: (err as Error).message }))
      .finally(() => {
        running = false;
      });
  }, INTERVAL_MS);
  timer.unref();
}

export function stopWebhookWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
