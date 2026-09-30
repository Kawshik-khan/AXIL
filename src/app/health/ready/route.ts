import fs from "fs";
import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { checkDependencies, failingDependencyReason } from "@/lib/dependency-health";
import { logger } from "@/lib/logger";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

let lastNotReadyLogAt = 0;

/**
 * Readiness (FIX_IMPLEMENTATION_PLAN FX-20 / FX-24 / FX-45, audit L3). Not ready when the store can't persist: the last
 * write failed, writing is blocked, this process doesn't hold the single-writer lock (JSON file), it hasn't synced from other servers for 30 s (Postgres),
 * the data directory isn't writable (JSON), Postgres doesn't answer within 2 s or the store hasn't loaded yet
 * (Postgres). Records Postgres refused (the rest keeps saving) make it "degraded" with 200, so one bad record raises an
 * alert without taking every workspace out of a load balancer (Phase 4 security review L4).
 *
 * The endpoint is unauthenticated, so it returns booleans and reason codes only. Paths, pids, host names and raw
 * error text go to the log (Phase 2 security review L-1).
 */
async function handleGET(request: Request) {
  const persistence = db.getPersistenceHealth();
  const postgres = persistence.backend === "pg";
  let writable = true;
  if (!postgres) {
    try {
      fs.accessSync(persistence.data_dir, fs.constants.W_OK);
    } catch {
      writable = false;
    }
  }
  const databaseReachable = postgres ? await db.pingDatabase(2_000) : true;
  // Refused rows alone: every other write still saves.
  const onlyRowsRefused =
    !persistence.ok && persistence.unsaved_rows > 0 && persistence.ready && !persistence.blocked_code && !persistence.last_persist_error && persistence.lock.held;
  // ?scope=core is what the platform's restart-on-failure health check should call: the store and its database only.
  // A third-party outage (Qdrant, Redis, the LLM provider) must not make Render restart a healthy instance, which
  // would reload the whole store for nothing. The default answer includes those services for monitors and smoke tests.
  const coreOnly = new URL(request.url).searchParams.get("scope") === "core";
  const dependencies = coreOnly ? null : await checkDependencies();
  const dependencyReason = dependencies ? failingDependencyReason(dependencies) : null;
  const ready = (persistence.ok || onlyRowsRefused) && writable && databaseReachable && !dependencyReason;
  // Logged at most once a minute: the endpoint is polled and unauthenticated.
  if ((!ready || onlyRowsRefused) && Date.now() - lastNotReadyLogAt > 60_000) {
    lastNotReadyLogAt = Date.now();
    logger.warn("health.not_ready", {
      backend: persistence.backend,
      blocked_reason: persistence.blocked_reason,
      last_persist_error: persistence.last_persist_error?.message ?? null,
      data_dir_writable: writable,
      database_reachable: databaseReachable,
      unsaved_rows: persistence.unsaved_rows,
      lock_owner: persistence.lock.owner ?? null,
      dependency_reason: dependencyReason,
    });
  }
  const reason = persistence.blocked_code
    ?? (!persistence.ready ? "STORE_NOT_READY" : null)
    ?? (!databaseReachable ? "DATABASE_UNREACHABLE" : null)
    ?? (persistence.last_persist_error ? "PERSIST_FAILED" : null)
    ?? (persistence.unsaved_rows > 0 ? "ROWS_NOT_SAVED" : null)
    ?? (!persistence.lock.held && persistence.ok === false ? "LOCK_NOT_HELD" : null)
    ?? (!writable ? "DATA_DIR_NOT_WRITABLE" : null)
    ?? dependencyReason;
  return NextResponse.json(
    {
      status: !ready ? "not_ready" : onlyRowsRefused ? "degraded" : "ready",
      reason: ready && !onlyRowsRefused ? null : reason,
      checks: {
        persistence: {
          ok: persistence.ok,
          backend: persistence.backend,
          loaded: persistence.ready,
          last_persist_at: persistence.last_persist_at,
          last_persist_failed_at: persistence.last_persist_error?.at ?? null,
          pending_writes: persistence.dirty,
          unsaved_rows: persistence.unsaved_rows,
          debounce_ms: persistence.debounce_ms,
        },
        ...(postgres ? { database_reachable: databaseReachable } : { data_dir_writable: writable }),
        writer_lock: { held: persistence.lock.held },
        ...(dependencies ? { dependencies } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = withStore("GET", handleGET);
