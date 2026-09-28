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

function workerEnv(dataDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env, NODE_ENV: "development", COMMERCEOS_DATA_DIR: dataDir, PERSIST_DEBOUNCE_MS: "250" };
  delete env.DATABASE_URL;
  delete env.UPSTASH_REDIS_REST_URL;
  return env;
}

function runWorker(scenario: string, dataDir: string): Record<string, unknown> {
  const res = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/persistence-worker.ts", scenario], {
    cwd: ROOT,
    env: workerEnv(dataDir),
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
      const second = runWorker("second-writer", dir);
      assert.strictEqual(second.lock_held, false);
      assert.strictEqual(second.ok, false, "the second writer reports not ready");
      assert.strictEqual(second.owner_pid, first.pid);
      assert.strictEqual(second.flushes, 0, "the second writer never writes the store");

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

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Persistence suite crashed:", err);
  process.exit(1);
});
