/**
 * Child process for tests/persistence-tests.ts: runs the REAL store (NODE_ENV is not "test") against a throwaway data
 * directory given by COMMERCEOS_DATA_DIR, performs one scenario, prints a JSON result line and exits.
 */
import fs from "fs";
import path from "path";

const scenario = process.argv[process.argv.length - 1]; // ts-runner puts the script path before our argument
const dataDir = process.env.COMMERCEOS_DATA_DIR as string;

// Count atomic renames (= completed flushes) before the store module loads.
let renames = 0;
const originalRename = fs.promises.rename.bind(fs.promises);
fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
  renames++;
  return originalRename(from, to);
}) as typeof fs.promises.rename;

const out = (result: Record<string, unknown>) => process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);

async function main() {
  const { db } = await import("@/infrastructure/db");

  if (scenario === "coalesce") {
    // Build a realistically large store, then time many small mutations.
    const now = new Date().toISOString();
    for (let i = 0; i < 20_000; i++) {
      db.data.customers.push({
        id: `cus_bulk_${i}`, tenant_id: "ten_bulk", first_name: `Customer${i}`, last_name: "Bulk", phone: `+88017${String(i).padStart(8, "0")}`,
        status: "ACTIVE", source: "WEBSITE", created_at: now, updated_at: now,
      } as never);
    }
    db.markDirty();
    await db.flush();
    const sizeMb = fs.statSync(path.join(dataDir, "commerceos.json")).size / 1_048_576;
    const baseline = renames;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 300; i++) {
      db.createAuditLog({ id: `aud_perf_${i}`, tenant_id: "ten_bulk", actor_user_id: "usr_x", action: "PERF", resource_type: "x", resource_id: String(i), metadata: {}, created_at: now } as never);
    }
    const mutateMs = Number(process.hrtime.bigint() - t0) / 1e6;
    await new Promise((r) => setTimeout(r, Number(process.env.PERSIST_DEBOUNCE_MS ?? 250) + 300));
    await db.flush();
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "commerceos.json"), "utf-8")) as { audit_logs: Array<{ id: string }> };
    out({
      size_mb: Math.round(sizeMb * 10) / 10,
      mutations: 300,
      mutate_ms: Math.round(mutateMs),
      flushes: renames - baseline,
      last_audit_persisted: persisted.audit_logs.some((a) => a.id === "aud_perf_299"),
      health_ok: db.getPersistenceHealth().ok,
      tmp_left: fs.readdirSync(dataDir).filter((f) => f.includes(".tmp")),
    });
    return;
  }

  if (scenario === "hold-lock") {
    out({ lock_held: db.getPersistenceHealth().lock.held, pid: process.pid });
    await new Promise((r) => setTimeout(r, 15_000)); // keep the lock while the test runs a second writer
    return;
  }

  if (scenario === "second-writer") {
    const health = db.getPersistenceHealth();
    let writeRejected: string | null = null;
    try {
      db.createAuditLog({ id: "aud_second", tenant_id: "t", actor_user_id: "u", action: "X", resource_type: "x", resource_id: "1", metadata: {}, created_at: new Date().toISOString() } as never);
    } catch (err) {
      writeRejected = (err as { code?: string }).code ?? "unknown";
    }
    await new Promise((r) => setTimeout(r, 600));
    await db.flush();
    out({
      lock_held: health.lock.held, ok: health.ok, blocked: health.blocked_reason, blocked_code: health.blocked_code,
      owner_pid: health.lock.owner?.pid ?? null, flushes: renames, write_rejected: writeRejected,
    });
    return;
  }

  if (scenario === "other-host") {
    // The test wrote a lock owned by a live-looking process on another host before this process started.
    const health = db.getPersistenceHealth();
    const { GET } = await import("@/app/health/ready/route");
    const res = await GET();
    out({
      lock_held: health.lock.held, blocked_code: health.blocked_code, seeded_users: db.data.users.length,
      ready_status: res.status, ready_body: await res.text(), lock_left: fs.readFileSync(path.join(dataDir, "commerceos.lock"), "utf-8"),
    });
    return;
  }

  if (scenario === "quarantine") {
    out({
      quarantined: fs.existsSync(path.join(dataDir, "quarantine")) ? fs.readdirSync(path.join(dataDir, "quarantine")) : [],
      tmp_left: fs.readdirSync(dataDir).filter((f) => f.startsWith("commerceos.json.tmp")),
    });
    return;
  }

  if (scenario === "write-failure") {
    // Make the data file's directory unusable for the rename: replace the target with a directory.
    await db.flush();
    fs.rmSync(path.join(dataDir, "commerceos.json"), { force: true });
    fs.mkdirSync(path.join(dataDir, "commerceos.json"));
    db.createAuditLog({ id: "aud_fail", tenant_id: "t", actor_user_id: "u", action: "X", resource_type: "x", resource_id: "1", metadata: {}, created_at: new Date().toISOString() } as never);
    // Poll rather than sleep a fixed time, so a loaded machine can't make the check flaky.
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 100));
    };
    await until(() => db.getPersistenceHealth().last_persist_error !== null);
    const failed = db.getPersistenceHealth();
    fs.rmdirSync(path.join(dataDir, "commerceos.json"));
    await until(() => db.getPersistenceHealth().ok && !db.getPersistenceHealth().dirty); // automatic retry after 1 s
    const recovered = db.getPersistenceHealth();
    out({ failed_ok: failed.ok, failed_error: failed.last_persist_error?.message ?? null, recovered_ok: recovered.ok, recovered_dirty: recovered.dirty });
    return;
  }

  out({ error: `unknown scenario ${scenario}` });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.stack : err));
    process.exit(1);
  });
