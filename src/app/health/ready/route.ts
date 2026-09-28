import fs from "fs";
import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";

export const dynamic = "force-dynamic";

/**
 * Readiness (FIX_IMPLEMENTATION_PLAN FX-20 / FX-24, audit L3). Not ready when the JSON store can't be persisted: the
 * last write failed, writing is blocked (unreadable data file, another process owns the store), this process doesn't
 * hold the single-writer lock, or the data directory isn't writable. It used to answer "ready" unconditionally.
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
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        persistence: {
          ok: persistence.ok,
          last_persist_at: persistence.last_persist_at,
          last_persist_error: persistence.last_persist_error,
          blocked_reason: persistence.blocked_reason,
          pending_writes: persistence.dirty,
          debounce_ms: persistence.debounce_ms,
        },
        data_dir_writable: writable,
        writer_lock: persistence.lock.held
          ? { held: true }
          : { held: false, owner: persistence.lock.owner ?? null },
      },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
