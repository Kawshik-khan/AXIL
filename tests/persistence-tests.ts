/**
 * Phase 2 persistence suite (FIX_IMPLEMENTATION_PLAN FX-20 / FX-24, audit C6/C7/L3).
 * Each scenario runs the REAL store in a child process against a throwaway data directory. The app's .data/ is never
 * touched. Run: node tests/ts-runner.cjs ./tests/persistence-tests.ts
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failedCount++;
  }
}

const ROOT = path.resolve(__dirname, "..");
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "commerceos-persist-"));

/** `readOnly`: the fixture records the store's refusal to start instead of exiting, so the scenario can report. */
function workerEnv(dataDir: string, opts: { readOnly?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", COMMERCEOS_DATA_DIR: dataDir, PERSIST_DEBOUNCE_MS: "250" };
  if (opts.readOnly) env.PERSIST_TEST_CAPTURE_EXIT = "1";
  else delete env.PERSIST_TEST_CAPTURE_EXIT;
  // Blank, not delete: the test runner refills unset variables from .env.local, which can select the real Postgres.
  for (const key of ["DATA_BACKEND", "DATABASE_URL", "DATABASE_URL_POOLED", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "QDRANT_URL"]) env[key] = "";
  return env;
}

function runWorker(scenario: string, dataDir: string, opts: { readOnly?: boolean } = {}): Record<string, unknown> {
  const res = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", scenario], {
    cwd: ROOT,
    env: workerEnv(dataDir, opts),
    encoding: "utf-8",
    timeout: 120_000,
  });
  const line = (res.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`worker ${scenario} produced no result (exit ${res.status}): ${(res.stderr || "").slice(0, 400)}`);
  return JSON.parse(line.slice(7));
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 2: PERSISTENCE (FX-20 / FX-24)    ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  await runTest("300 writes to a multi-MB store are coalesced into 1-2 flushes and don't block the request", () => {
    const dir = tempDir();
    try {
      const r = runWorker("coalesce", dir);
      console.log(`      store ${r.size_mb} MB, 300 mutations in ${r.mutate_ms} ms, ${r.flushes} flush(es)`);
      assert.ok(Number(r.size_mb) > 2, "the store is large enough to matter");
      assert.ok(Number(r.flushes) >= 1 && Number(r.flushes) <= 2, `expected 1-2 flushes, got ${r.flushes}`);
      assert.ok(Number(r.mutate_ms) < 500, `mutations must not wait for disk writes (took ${r.mutate_ms} ms)`);
      assert.strictEqual(r.last_audit_persisted, true, "the last write reached disk");
      assert.strictEqual(r.health_ok, true);
      assert.deepStrictEqual(r.tmp_left, [], "no temp files left behind");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("a failed write is reported (not ready), kept dirty, and retried until it succeeds", () => {
    const dir = tempDir();
    try {
      const r = runWorker("write-failure", dir);
      assert.strictEqual(r.failed_ok, false, "persistence health reports the failure");
      assert.ok(r.failed_error, "the error message is kept");
      assert.strictEqual(r.recovered_ok, true, "the automatic retry succeeds once the cause is gone");
      assert.strictEqual(r.recovered_dirty, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("stale temp files from a crash are quarantined at start, never deleted", () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(path.join(dir, "commerceos.json.tmp.1712345678"), '{"lost":"writes"}');
      fs.writeFileSync(path.join(dir, "commerceos.json.tmp"), '{"lost":"writes"}');
      const r = runWorker("quarantine", dir);
      assert.deepStrictEqual((r.tmp_left as string[]).length, 0);
      assert.deepStrictEqual((r.quarantined as string[]).sort(), ["commerceos.json.tmp", "commerceos.json.tmp.1712345678"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("a second writer process is blocked while the first holds the lock; a stale lock is taken over", async () => {
    const dir = tempDir();
    const holder = spawn(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", "hold-lock"], {
      cwd: ROOT,
      env: workerEnv(dir),
    });
    try {
      const first = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let buf = "";
        holder.stdout.on("data", (d) => {
          buf += String(d);
          const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
          if (line) resolve(JSON.parse(line.slice(7)));
        });
        holder.on("exit", () => reject(new Error("holder exited early")));
        setTimeout(() => reject(new Error("holder timeout")), 60_000);
      });
      assert.strictEqual(first.lock_held, true);
      // Default: a second app process refuses to start.
      const refused = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", "second-writer"], {
        cwd: ROOT,
        env: workerEnv(dir),
        encoding: "utf-8",
        timeout: 60_000,
      });
      assert.strictEqual(refused.status, 1, "a second writer process exits");
      assert.ok(/refused to start: the data store is in use by another process/.test(refused.stderr), refused.stderr.slice(0, 300));
      assert.ok(!/RESULT /.test(refused.stdout), "it never got as far as serving");

      // What the refused process saw (its exit captured by the fixture): blocked, and every write refused.
      const second = runWorker("second-writer", dir, { readOnly: true });
      assert.strictEqual(second.refused_exit, 1);
      assert.strictEqual(second.lock_held, false);
      assert.strictEqual(second.ok, false, "the second writer reports not ready");
      assert.strictEqual(second.owner_pid, first.pid);
      assert.strictEqual(second.blocked_code, "LOCK_HELD_BY_OTHER_PROCESS");
      assert.strictEqual(second.flushes, 0, "the second writer never writes the store");
      assert.strictEqual(second.write_rejected, "STORE_UNAVAILABLE", "a write it can't save is refused, not acknowledged");

      // Next.js helper processes (JEST_WORKER_ID) load route modules while the app runs: no exit, no lock, no write.
      const lockBefore = fs.readFileSync(path.join(dir, "commerceos.lock"), "utf-8");
      const helper = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", "next-helper"], {
        cwd: ROOT,
        env: { ...workerEnv(dir), JEST_WORKER_ID: "1" },
        encoding: "utf-8",
        timeout: 60_000,
      });
      assert.strictEqual(helper.status, 0, `a Next helper process loads normally: ${helper.stderr.slice(0, 200)}`);
      const helperResult = JSON.parse(helper.stdout.split("\n").find((l) => l.startsWith("RESULT "))!.slice(7)) as Record<string, unknown>;
      assert.strictEqual(helperResult.lock_held, false);
      assert.strictEqual(helperResult.flushes, 0, "a helper process never writes the store");
      assert.strictEqual(fs.readFileSync(path.join(dir, "commerceos.lock"), "utf-8"), lockBefore, "the app's lock is untouched");

      const seed = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./scripts/reset-seed-passwords.ts"], {
        cwd: ROOT,
        env: { ...workerEnv(dir), SEED_ADMIN_PASSWORD: "Throwaway-Seed-Pass-1234" },
        encoding: "utf-8",
        timeout: 60_000,
      });
      assert.strictEqual(seed.status, 1, "store-writing scripts refuse to run while the app holds the lock");
      assert.ok(/in use by another process/.test(seed.stderr), seed.stderr.slice(0, 200));
    } finally {
      holder.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      // The holder was killed without cleaning up: its lock is stale and a new process takes it over.
      fs.writeFileSync(path.join(dir, "commerceos.lock"), JSON.stringify({ pid: 999_999, host: os.hostname(), started_at: "2020-01-01T00:00:00Z" }));
      const next = runWorker("second-writer", dir);
      assert.strictEqual(next.lock_held, true, "stale lock taken over");
      assert.ok(Number(next.flushes) >= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("a lock held on another host is never taken over; nothing is seeded; readiness leaks no paths, pids or hosts", () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(
        path.join(dir, "commerceos.lock"),
        JSON.stringify({ pid: 4242, host: "replica-b.internal", started_at: new Date().toISOString() })
      );
      const r = runWorker("other-host", dir, { readOnly: true });
      assert.strictEqual(r.lock_held, false);
      assert.strictEqual(r.blocked_code, "LOCK_HELD_ON_OTHER_HOST");
      assert.strictEqual(r.refused_exit, 1, "the app refuses to start");
      assert.strictEqual(r.seeded_users, 0, "a blocked store doesn't seed accounts in memory");
      assert.strictEqual(r.ready_status, 503);
      const body = String(r.ready_body);
      assert.ok(/LOCK_HELD_ON_OTHER_HOST/.test(body), body);
      for (const leak of ["replica-b", "4242", dir.replace(/\\/g, "\\\\"), os.hostname()]) {
        assert.ok(!body.includes(leak), `readiness body leaks ${leak}: ${body}`);
      }
      assert.ok(String(r.lock_left).includes("replica-b.internal"), "the other host's lock is left in place");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("two processes taking over the same stale lock at once end with exactly one writer", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "commerceos.lock"), JSON.stringify({ pid: 999_998, host: os.hostname(), started_at: "2020-01-01T00:00:00Z" }));
    const start = () => {
      const child = spawn(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", "hold-lock"], {
        cwd: ROOT,
        env: workerEnv(dir, { readOnly: true }), // the loser reports instead of exiting
      });
      const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        let buf = "";
        child.stdout.on("data", (d) => {
          buf += String(d);
          const line = buf.split("\n").find((l) => l.startsWith("RESULT "));
          if (line) resolve(JSON.parse(line.slice(7)));
        });
        child.on("exit", () => reject(new Error("worker exited early")));
        setTimeout(() => reject(new Error("worker timeout")), 60_000);
      });
      return { child, result };
    };
    const a = start();
    const b = start();
    try {
      const [ra, rb] = await Promise.all([a.result, b.result]);
      const holders = [ra, rb].filter((r) => r.lock_held === true).length;
      assert.strictEqual(holders, 1, `lock holders: ${JSON.stringify([ra, rb])}`);
      assert.strictEqual((ra.lock_held ? rb : ra).refused_exit, 1, "the other one refuses to start");
      const owner = JSON.parse(fs.readFileSync(path.join(dir, "commerceos.lock"), "utf-8")) as { pid: number };
      assert.strictEqual(owner.pid, (ra.lock_held ? ra : rb).pid, "the lock file names the one holder");
    } finally {
      a.child.kill();
      b.child.kill();
      await new Promise((r) => setTimeout(r, 500));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("a writer whose lock was replaced stops writing (fencing before every flush)", () => {
    const dir = tempDir();
    try {
      const r = runWorker("lock-lost", dir);
      assert.strictEqual(r.flushes_after_loss, 0, "no write after the lock stopped naming this process");
      assert.strictEqual(r.blocked_code, "LOCK_LOST");
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.next_write, "STORE_UNAVAILABLE");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await runTest("a lock that exists but can't be read is never taken over", () => {
    const dir = tempDir();
    try {
      fs.mkdirSync(path.join(dir, "commerceos.lock")); // exists, can't be read as a file (like EACCES/EBUSY)
      const r = runWorker("unreadable-lock", dir, { readOnly: true });
      assert.strictEqual(r.lock_held, false);
      assert.strictEqual(r.blocked_code, "LOCK_UNAVAILABLE");
      assert.strictEqual(r.refused_exit, 1);
      assert.ok(fs.statSync(path.join(dir, "commerceos.lock")).isDirectory(), "left in place");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Persistence suite crashed:", err);
  process.exit(1);
});
