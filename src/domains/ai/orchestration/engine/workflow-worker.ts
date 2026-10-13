/**
 * Postgres-backed workflow command worker. Commands are claimed in store units and delivered at least once.
 * Handler/domain actions must remain idempotent; uncertain external outcomes are not blindly replayed.
 */
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { isAppError } from "@/lib/errors";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { isFeatureEnabled } from "@/lib/safety-gate";
import { workflowEngine } from "./workflow-engine";
import { WorkflowJob } from "@/types/orchestration";

const INTERVAL_MS = 5_000;
const CLAIM_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const MAX_PER_PASS = 4;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
let timer: ReturnType<typeof setInterval> | null = null;
let activePass: Promise<void> | null = null;
let lastServedTenantId: string | undefined;
const activeExecutions = new Set<AbortController>();

function due(job: WorkflowJob, nowIso: string): boolean {
  return job.status === "PENDING" ||
    (job.status === "RETRY_SCHEDULED" && (!job.next_attempt_at || job.next_attempt_at <= nowIso)) ||
    (job.status === "IN_FLIGHT" && !!job.claimed_until && job.claimed_until < nowIso);
}

async function claim(jobId: string, tenantId: string): Promise<WorkflowJob | null> {
  const now = new Date();
  const claimToken = randomUUID();
  try {
    return await db.unit(async () => {
      const current = db.getWorkflowJobById(tenantId, jobId);
      if (!current || !due(current, now.toISOString())) return null;
      const workflow = db.getWorkflowById(tenantId, current.workflow_id);
      const tenant = db.findTenantById(tenantId);
      if (!workflow || !tenant || tenant.status !== "ACTIVE") return null;
      if (PlatformSafetyService.isExecutionBlocked("WORKFLOW", tenantId) || !isFeatureEnabled("autonomous", tenantId)) return null;
      const claimed = db.updateWorkflowJob(tenantId, jobId, {
        status: "IN_FLIGHT",
        attempt_count: current.attempt_count + 1,
        claim_token: claimToken,
        fence_version: (current.fence_version || 0) + 1,
        claimed_until: new Date(now.getTime() + CLAIM_MS).toISOString(),
        next_attempt_at: undefined,
      });
      return claimed || null;
    }, () => true);
  } catch (err) {
    if (isAppError(err) && err.statusCode === 409) return null;
    throw err;
  }
}

async function updateOwned(job: WorkflowJob, patch: Partial<WorkflowJob>): Promise<boolean> {
  return db.unit(async () => {
    const current = db.getWorkflowJobById(job.tenant_id, job.id);
    if (!current || current.status !== "IN_FLIGHT" || current.claim_token !== job.claim_token || current.fence_version !== job.fence_version) return false;
    db.updateWorkflowJob(job.tenant_id, job.id, patch);
    return true;
  }, () => true);
}

async function processJob(jobId: string, tenantId: string): Promise<void> {
  const job = await claim(jobId, tenantId);
  if (!job) return;
  const execution = new AbortController();
  activeExecutions.add(execution);
  let pollingCancellation = false;
  const cancellationPoll = setInterval(() => {
    if (pollingCancellation || execution.signal.aborted) return;
    pollingCancellation = true;
    void db.syncIfDue().then(() => {
      const currentJob = db.getWorkflowJobById(job.tenant_id, job.id);
      const workflow = db.getWorkflowById(job.tenant_id, job.workflow_id);
      if (!currentJob || currentJob.status !== "IN_FLIGHT" || currentJob.claim_token !== job.claim_token || currentJob.fence_version !== job.fence_version ||
          (!!currentJob.claimed_until && Date.parse(currentJob.claimed_until) <= Date.now()) ||
          !workflow || workflow.status === "CANCELLED" || workflow.status === "PAUSED") {
        execution.abort();
      }
    }).catch((err: unknown) => logger.warn("ai.workflow_worker_cancel_poll_failed", { job_id: job.id, error: (err as Error).message }))
      .finally(() => { pollingCancellation = false; });
  }, 1_000);
  cancellationPoll.unref();
  const heartbeat = setInterval(() => {
    void updateOwned(job, { claimed_until: new Date(Date.now() + CLAIM_MS).toISOString() })
      .catch((err: unknown) => logger.warn("ai.workflow_worker_heartbeat_failed", { job_id: job.id, error: (err as Error).message }));
  }, HEARTBEAT_MS);
  heartbeat.unref();

  try {
    await workflowEngine.executeQueuedAction(job, execution.signal);
    await updateOwned(job, {
      status: "COMPLETED",
      claim_token: undefined,
      claimed_until: undefined,
      last_error: undefined,
    });
  } catch (err) {
    const latest = db.getWorkflowJobById(job.tenant_id, job.id);
    if (!latest || latest.claim_token !== job.claim_token) return;
    const permanent = isAppError(err) && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 409;
    const exhausted = permanent || job.attempt_count >= job.max_attempts;
    const backoff = BACKOFF_MS[Math.min(Math.max(0, job.attempt_count - 1), BACKOFF_MS.length - 1)];
    const message = isAppError(err) ? err.code : "WORKFLOW_EXECUTION_FAILED";
    await updateOwned(job, {
      status: exhausted ? "DEAD_LETTERED" : "RETRY_SCHEDULED",
      next_attempt_at: exhausted ? undefined : new Date(Date.now() + backoff).toISOString(),
      last_error: message,
      claim_token: undefined,
      claimed_until: undefined,
    });
    logger.warn("ai.workflow_job_failed", { tenant_id: job.tenant_id, workflow_id: job.workflow_id, job_id: job.id, attempt: job.attempt_count, outcome: exhausted ? "DEAD_LETTERED" : "RETRY_SCHEDULED", error: message });
  } finally {
    clearInterval(cancellationPoll);
    clearInterval(heartbeat);
    activeExecutions.delete(execution);
  }
}

export async function runWorkflowWorkerOnce(): Promise<void> {
  if (activePass) return activePass;
  const pass = (async () => {
    const jobs = db.getDueWorkflowJobs(new Date().toISOString(), MAX_PER_PASS, lastServedTenantId);
    // Each job with its own scope for zero-hydration rows (outside any request)
    for (const job of jobs) await db.withFreshTenantReads(() => processJob(job.id, job.tenant_id));
    if (jobs.length) lastServedTenantId = jobs[jobs.length - 1].tenant_id;
  })();
  activePass = pass;
  try { await pass; } finally { if (activePass === pass) activePass = null; }
}

export function startWorkflowWorker(): void {
  if (timer || process.env.AI_WORKFLOW_WORKER === "0" || process.env.NEXT_PHASE === "phase-production-build") return;
  timer = setInterval(() => {
    void runWorkflowWorkerOnce().catch((err: unknown) => logger.warn("ai.workflow_worker_pass_failed", { error: (err as Error).message }));
  }, INTERVAL_MS);
  timer.unref();
}

export async function stopWorkflowWorker(drainTimeoutMs = 30_000): Promise<{ drained: boolean }> {
  if (timer) clearInterval(timer);
  timer = null;
  for (const execution of activeExecutions) execution.abort();
  const pass = activePass;
  if (!pass) return { drained: true };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const completed = await Promise.race([
      pass.then(() => true),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), Math.max(0, drainTimeoutMs)); timeout.unref?.(); }),
    ]);
    // If the deadline expires, the job lease remains durable and will be
    // reclaimed after expiry; callers must not report a successful drain.
    return { drained: completed };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
