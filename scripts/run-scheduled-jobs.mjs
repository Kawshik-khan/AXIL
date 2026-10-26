#!/usr/bin/env node
/**
 * Scheduled jobs (FX-99 Part B): run every 10 minutes by the GitHub Actions
 * workflow .github/workflows/scheduled-jobs.yml (free; a Render Cron Job running this script works the same).
 *
 * Calls POST /api/v1/jobs/<job>/run for every job. The server runs a job at most once per its own time bucket
 * (monitoring every 5 min, webhook-reconcile and outbound-redeliver every 10 min, courier-poll every 30 min, webhook-canary hourly,
 * daily-report and low-stock hourly at the shop's local hour,
 * rto-followup, retention-purge and knowledge-reindex daily, cod-reconciliation weekly); a call inside a bucket that
 * already ran returns the stored result, so calling them all every time is safe and cheap.
 *
 * Environment: APP_URL (https address of the app) and JOBS_TOKEN (the token whose SHA-256 is JOBS_TOKEN_SHA256 on the
 * app). Exits 1 when a job fails or the app refuses the token, so Render shows the run as failed.
 * Node built-ins only: no install step.
 */

/** Must list every job in JOBS (src/domains/jobs/jobs.service.ts); tests/stage3-quality-tests.ts checks it. */
const JOB_NAMES = [
  "monitoring",
  "courier-poll",
  "daily-report",
  "low-stock",
  "rto-followup",
  "cod-reconciliation",
  "retention-purge",
  "knowledge-reindex",
  "connection-health",
  "webhook-reconcile",
  "webhook-canary",
  "outbound-redeliver",
];

const TIMEOUT_MS = 120_000;

async function runJob(base, token, job) {
  const res = await fetch(`${base}/api/v1/jobs/${job}/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `${job}:cron-${Date.now()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  // 409: the same job is still running from another call; it isn't a failure of this run
  const ok = res.ok || res.status === 409;
  const detail = res.ok ? (body?.data?.replayed ? "already ran in this period" : "ran") : body?.error?.code ?? `HTTP ${res.status}`;
  return { job, ok, status: res.status, detail };
}

async function main() {
  const base = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.JOBS_TOKEN ?? "").trim();
  if (!/^https?:\/\//.test(base) || token.length < 32) {
    console.error("Set APP_URL (the app's https address) and JOBS_TOKEN (32+ characters).");
    process.exit(1);
  }
  let failed = 0;
  for (const job of JOB_NAMES) {
    try {
      const r = await runJob(base, token, job);
      console.log(JSON.stringify({ event: "scheduled_job", ...r }));
      if (!r.ok) failed++;
    } catch (err) {
      failed++;
      console.log(JSON.stringify({ event: "scheduled_job", job, ok: false, detail: err instanceof Error ? err.name : "error" }));
    }
  }
  process.exit(failed ? 1 : 0);
}

await main();
