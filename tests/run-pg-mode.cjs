/**
 * `npm run test:pg` (ADR-108): runs every suite of `npm test` with the store persisted to an in-memory PGlite database
 * (COMMERCEOS_TEST_PG=1). Each suite must pass AND reload from Postgres identically; see tests/support/pg-test-store.ts.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const suites = require(path.join(ROOT, "package.json")).scripts.test.match(/\.\/tests\/[\w-]+\.ts/g);
let failed = 0;
for (const suite of suites) {
  const res = spawnSync(process.execPath, ["tests/ts-runner.cjs", suite], {
    cwd: ROOT,
    env: { ...process.env, COMMERCEOS_TEST_PG: "1" },
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${res.stdout}${res.stderr}`;
  const passed = (output.match(/✓/g) || []).length;
  const failures = (output.match(/✗/g) || []).length;
  const roundTrip = /round trip OK/.test(output);
  const ok = res.status === 0 && failures === 0 && roundTrip;
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${path.basename(suite, ".ts").padEnd(34)} ✓=${passed} ✗=${failures} ${roundTrip ? "round trip OK" : "round trip FAILED"}\n`);
  if (!ok) {
    const lines = output.split("\n").filter((l) => /✗|FAILED|unsaved|crashed|failed to start/.test(l)).slice(0, 12);
    for (const line of lines) process.stdout.write(`       ${line}\n`);
  }
}
process.stdout.write(`${suites.length - failed}/${suites.length} suites pass on Postgres\n`);
process.exit(failed ? 1 : 0);
