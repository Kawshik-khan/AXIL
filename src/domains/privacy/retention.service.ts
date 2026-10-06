/**
 * Retention purge (FX-83, audit F25), run nightly as the `retention-purge` job (FX-99 Part B).
 * - Tool-call payloads (arguments and results): emptied after 30 days; the row stays for counts and timings.
 * - Shadow drafts on conversations: removed after 30 days.
 * - Finished customer-agent jobs: deleted after 7 days.
 * - Delivered outbox rows and scheduled-job results: deleted after 30 days (dead outbox rows stay until resolved).
 * - Customer messages and agent runs: deleted after CUSTOMER_DATA_RETENTION_DAYS, only when it's set. How long to keep
 *   chats is the owner's decision (the plan proposes 18 months, ~548 days); unset keeps them.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";

const DAY = 24 * 60 * 60_000;
export const TOOL_PAYLOAD_DAYS = 30;
export const SHADOW_REPLY_DAYS = 30;
export const AGENT_JOB_DAYS = 7;
export const OUTBOX_DAYS = 30;

export interface PurgeResult {
  tool_payloads_cleared: number;
  shadow_replies_removed: number;
  agent_jobs_deleted: number;
  outbox_rows_deleted: number;
  job_runs_deleted: number;
  messages_deleted: number;
  agent_runs_deleted: number;
  retention_days: number | null;
}

export function messageRetentionDays(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.CUSTOMER_DATA_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 30 ? n : null; // under 30 days is a typo, not a policy
}

export class RetentionService {
  /** One purge pass over every workspace. Call it inside a unit of work. */
  public static purge(now = Date.now(), env: NodeJS.ProcessEnv = process.env): PurgeResult {
    const data = db.data;
    const before = (days: number) => new Date(now - days * DAY).toISOString();
    const result: PurgeResult = { tool_payloads_cleared: 0, shadow_replies_removed: 0, agent_jobs_deleted: 0, outbox_rows_deleted: 0, job_runs_deleted: 0, messages_deleted: 0, agent_runs_deleted: 0, retention_days: messageRetentionDays(env) };

    const payloadCutoff = before(TOOL_PAYLOAD_DAYS);
    for (const call of data.agent_tool_calls) {
      if (call.created_at < payloadCutoff && (Object.keys(call.input_arguments ?? {}).length || call.sanitized_result !== undefined)) {
        call.input_arguments = {};
        delete call.sanitized_result;
        result.tool_payloads_cleared++;
      }
    }

    const shadowCutoff = before(SHADOW_REPLY_DAYS);
    for (const convo of data.conversations) {
      const draft = convo.metadata?.agent_shadow_reply as { at?: string } | undefined;
      if (draft && (draft.at ?? "") < shadowCutoff) {
        const { agent_shadow_reply: _removed, ...rest } = convo.metadata;
        void _removed;
        convo.metadata = rest;
        result.shadow_replies_removed++;
      }
    }

    const jobCutoff = before(AGENT_JOB_DAYS);
    const jobsBefore = data.agent_jobs.length;
    data.agent_jobs = data.agent_jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING" || j.updated_at >= jobCutoff);
    result.agent_jobs_deleted = jobsBefore - data.agent_jobs.length;

    const outboxCutoff = before(OUTBOX_DAYS);
    const outboxBefore = data.domain_events.length;
    data.domain_events = data.domain_events.filter((e) => !(e.status === "DISPATCHED" && (e.dispatched_at ?? e.updated_at) < outboxCutoff));
    result.outbox_rows_deleted = outboxBefore - data.domain_events.length;
    const runsBefore = data.job_runs.length;
    data.job_runs = data.job_runs.filter((r) => r.started_at >= outboxCutoff);
    result.job_runs_deleted = runsBefore - data.job_runs.length;

    if (result.retention_days !== null) {
      const cutoff = before(result.retention_days);
      const messagesBefore = data.messages.length;
      data.messages = data.messages.filter((m) => m.created_at >= cutoff);
      result.messages_deleted = messagesBefore - data.messages.length;
      const oldRuns = new Set(data.agent_runs.filter((r) => r.created_at < cutoff).map((r) => r.id));
      data.agent_runs = data.agent_runs.filter((r) => !oldRuns.has(r.id));
      data.agent_tool_calls = data.agent_tool_calls.filter((c) => !oldRuns.has(c.agent_run_id));
      result.agent_runs_deleted = oldRuns.size;
    }

    if (Object.entries(result).some(([k, v]) => k !== "retention_days" && typeof v === "number" && v > 0)) {
      db.markDirty();
      logger.info("privacy.retention_purge", { ...result });
    }
    return result;
  }
}
