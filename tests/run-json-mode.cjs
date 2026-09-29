/**
 * Runs every suite of `npm test` separately (unlike `npm test`, it doesn't stop at the first failing suite) and
 * summarizes passes and failures per suite.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const suites = require(path.join(ROOT, "package.json")).scripts.test.match(/\.\/tests\/[\w-]+\.ts/g);
let failed = 0;
let total = 0;
for (const suite of suites) {
  const res = spawnSync(process.execPath, ["tests/ts-runner.cjs", suite], { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${res.stdout}${res.stderr}`;
  const passed = (output.match(/✓/g) || []).length;
  const failures = (output.match(/✗/g) || []).length;
  total += passed;
  const ok = res.status === 0 && failures === 0;
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${path.basename(suite, ".ts").padEnd(34)} ✓=${passed} ✗=${failures}\n`);
  if (!ok) {
    for (const line of output.split("\n").filter((l) => /✗|crashed|Error:/.test(l)).slice(0, 10)) process.stdout.write(`       ${line}\n`);
  }
}
process.stdout.write(`${suites.length - failed}/${suites.length} suites pass, ${total} tests passed\n`);
process.exit(failed ? 1 : 0);
