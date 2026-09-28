import fs from "fs";
import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

let lastNotReadyLogAt = 0;

/**
 * Readiness (FIX_IMPLEMENTATION_PLAN FX-20 / FX-24, audit L3). Not ready when the JSON store can't be persisted: the
 * last write failed, writing is blocked (unreadable data file, another process or host owns the store), this process
 * doesn't hold the single-writer lock, or the data directory isn't writable. It used to answer "ready" unconditionally.
 *
 * The endpoint is unauthenticated, so it returns booleans and reason codes only. Paths, pids, host names and raw
 * error text go to the log (Phase 2 security review L-1).
 */
export async function GET() {
  const persistence = db.getPersistenceHealth();
  let writable = true;
  try {
    fs.accessSync(persistence.data_dir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  const ready = persistence.ok && writable;
  // Logged at most once a minute: the endpoint is polled and unauthenticated.
  if (!ready && Date.now() - lastNotReadyLogAt > 60_000) {
    lastNotReadyLogAt = Date.now();
    logger.warn("health.not_ready", {
      blocked_reason: persistence.blocked_reason,
      last_persist_error: persistence.last_persist_error?.message ?? null,
      data_dir_writable: writable,
      lock_owner: persistence.lock.owner ?? null,
    });
  }
  const reason = persistence.blocked_code
    ?? (persistence.last_persist_error ? "PERSIST_FAILED" : null)
    ?? (!persistence.lock.held && persistence.ok === false ? "LOCK_NOT_HELD" : null)
    ?? (!writable ? "DATA_DIR_NOT_WRITABLE" : null);
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      reason: ready ? null : reason,
      checks: {
        persistence: {
          ok: persistence.ok,
          last_persist_at: persistence.last_persist_at,
          last_persist_failed_at: persistence.last_persist_error?.at ?? null,
          pending_writes: persistence.dirty,
          debounce_ms: persistence.debounce_ms,
        },
        data_dir_writable: writable,
        writer_lock: { held: persistence.lock.held },
      },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
