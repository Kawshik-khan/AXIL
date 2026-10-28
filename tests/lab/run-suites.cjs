/**
 * Test lab: runs every suite of `npm test` in parallel child processes, keeps going past failures, re-runs a failed
 * suite to tell FLAKY from FAIL, and reports durations (slowest first), ✓/✗ counts, JSON and JUnit XML.
 * `npm test` stays the sequential reference; this is the fast feedback loop.
 *
 *   node tests/lab/run-suites.cjs                      all suites, jobs = min(6, cpus - 1), 1 retry
 *   node tests/lab/run-suites.cjs --only rbac,security  suites whose name contains any of these
 *   node tests/lab/run-suites.cjs --typecheck --pg --jobs 4 --retries 0
 *
 * Each suite already runs in its own process with its own in-memory store (NODE_ENV=test), so suites don't share
 * state. --pg runs them on in-memory PGlite (COMMERCEOS_TEST_PG=1), as `npm run test:pg` does.
 * Output: lab-out/tests/<run>/{report.json, junit.xml, logs/<suite>.log}
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

const jobs = Math.max(1, Number(value("jobs", Math.min(6, Math.max(1, os.cpus().length - 1)))));
const retries = Math.max(0, Number(value("retries", 1)));
const only = value("only", "").split(",").filter(Boolean);
const pg = flag("pg");
const timeoutMs = Number(value("timeout", 10 * 60 * 1000));

const all = require(path.join(ROOT, "package.json")).scripts.test.match(/\.\/tests\/[\w./-]+\.ts/g);
const suites = only.length ? all.filter((s) => only.some((o) => s.includes(o))) : all;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(ROOT, "lab-out", "tests", runId);
fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      out += `\n[lab] killed after ${timeoutMs} ms\n`;
      child.kill();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, ms: Date.now() - t0 });
    });
  });
}

const name = (s) => path.basename(s, ".ts");
async function runSuite(suite) {
  const attempts = [];
  for (let a = 0; a <= retries; a++) {
    const r = await run(process.execPath, ["tests/ts-runner.cjs", suite], pg ? { COMMERCEOS_TEST_PG: "1" } : {});
    const passed = (r.out.match(/✓/g) || []).length;
    const failed = (r.out.match(/✗/g) || []).length;
    const ok = r.code === 0 && failed === 0 && (!pg || /round trip OK/.test(r.out));
    attempts.push({ ok, code: r.code, passed, failed, ms: r.ms });
    fs.writeFileSync(path.join(outDir, "logs", `${name(suite)}${a ? `.retry${a}` : ""}.log`), r.out);
    if (ok) break;
  }
  const last = attempts[attempts.length - 1];
  const status = attempts[0].ok ? "PASS" : last.ok ? "FLAKY" : "FAIL";
  // A suite's own ✗ line first: suites log expected errors ("api.unhandled_error") that aren't the failure
  const lines = status === "PASS" ? [] : fs.readFileSync(path.join(outDir, "logs", `${name(suite)}.log`), "utf8").split("\n");
  const firstFailure = (lines.find((l) => /✗/.test(l)) || lines.find((l) => /Error|FAIL/.test(l)) || "").replace(/\x1b\[\d+m/g, "").trim().slice(0, 200);
  return { suite: name(suite), status, attempts, ms: attempts[0].ms, passed: last.passed, failed: last.failed, first_failure: firstFailure };
}

const xml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

async function main() {
  const t0 = Date.now();
  const stages = [];
  if (flag("typecheck")) {
    process.stdout.write("typecheck … ");
    const r = await run(process.execPath, ["node_modules/typescript/lib/tsc.js", "--noEmit"], {});
    fs.writeFileSync(path.join(outDir, "logs", "typecheck.log"), r.out);
    stages.push({ stage: "typecheck", ok: r.code === 0, ms: r.ms });
    process.stdout.write(`${r.code === 0 ? "ok" : "FAILED"} (${(r.ms / 1000).toFixed(1)} s)\n`);
  }
  console.log(`${suites.length} suites, ${jobs} at a time, ${retries} retr${retries === 1 ? "y" : "ies"}${pg ? ", on PGlite" : ""}`);
  const queue = [...suites];
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (queue.length) {
        const r = await runSuite(queue.shift());
        results.push(r);
        const tag = r.status === "PASS" ? "ok   " : r.status === "FLAKY" ? "FLAKY" : "FAIL ";
        console.log(`${tag} ${r.suite.padEnd(40)} ${String((r.ms / 1000).toFixed(1)).padStart(6)} s  ✓${r.passed} ✗${r.failed}${r.first_failure ? `  ${r.first_failure}` : ""}`);
      }
    }),
  );
  const wall = Date.now() - t0;
  const serial = results.reduce((n, r) => n + r.ms, 0);
  const count = (s) => results.filter((r) => r.status === s).length;
  const report = { run: runId, pg, jobs, retries, wall_ms: wall, serial_ms: serial, stages, pass: count("PASS"), flaky: count("FLAKY"), fail: count("FAIL"), suites: results.sort((a, b) => b.ms - a.ms) };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  const cases = results.map((r) => `  <testcase classname="commerceos" name="${xml(r.suite)}" time="${(r.ms / 1000).toFixed(2)}">${r.status === "FAIL" ? `<failure message="${xml(r.first_failure)}"/>` : r.status === "FLAKY" ? `<system-out>FLAKY: passed on retry</system-out>` : ""}</testcase>`);
  fs.writeFileSync(path.join(outDir, "junit.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="commerceos" tests="${results.length}" failures="${count("FAIL")}" time="${(wall / 1000).toFixed(2)}">\n${cases.join("\n")}\n</testsuite>\n`);

  console.log(`\nslowest: ${report.suites.slice(0, 5).map((r) => `${r.suite} ${(r.ms / 1000).toFixed(0)}s`).join(", ")}`);
  console.log(`${report.pass} pass, ${report.flaky} flaky, ${report.fail} fail · wall ${(wall / 1000).toFixed(0)} s vs ${(serial / 1000).toFixed(0)} s serial · ${outDir}`);
  const ok = report.fail === 0 && stages.every((s) => s.ok);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
