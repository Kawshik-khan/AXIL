/**
 * Lab console (tests/lab/console): the experiment registry validates definitions and params strictly, the run engine
 * records runs and their output, and the local server refuses what it must: other Host headers, writes without the
 * page token or not as JSON, unknown params, paid runs without confirmation, and files outside lab-out/ and eval-out/.
 */
import assert from "assert";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

const registry = require("./lab/console/registry.cjs") as {
  loadExperiments: () => { experiments: Map<string, Experiment>; errors: string[] };
  describe: (e: Experiment, ctx: { root: string }) => { params: Array<{ name: string; options?: string[] }> };
  validate: (e: Experiment, input: unknown, ctx: { root: string }) => { values: Record<string, unknown>; errors: string[] };
  plan: (e: Experiment, values: Record<string, unknown>, ctx: { root: string; runId: string }) => { args: string[]; env: Record<string, string>; cost: string; warning: string };
  checkDefinition: (e: unknown, file: string) => unknown;
};
const { RunManager, summarizeLog } = require("./lab/console/runner.cjs") as { RunManager: new (o: { root: string; jobs: number }) => Runs; summarizeLog: (t: string) => string };
const { createConsole, safeFile } = require("./lab/console/server.cjs") as {
  createConsole: (o: { root: string; port: number; jobs: number; token: string }) => { listen: () => Promise<number>; close: () => Promise<void> };
  safeFile: (root: string, rel: string) => string | null;
};

interface Experiment { id: string; artifactRoots?: string[] }
interface Run { id: string; status: string; exit_code: number | null; summary: string; artifacts: string[] }
interface Runs { submit: (id: string, e: Experiment & { title: string; group: string }, v: object, p: { args: string[]; env: object; cost: string }) => Run; get: (id: string) => Run; log: (id: string) => string; subscribe: (id: string, fn: (ev: string) => void) => () => void; watch: (fn: (ev: string, run: Run) => void) => () => void; list: () => Run[] }

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

const ROOT = process.cwd();
const ctx = { root: ROOT };

function request(port: number, method: string, p: string, opts: { host?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(opts.headers || {}) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  console.log(`\n${BOLD}LAB CONSOLE${RESET}\n`);
  const { experiments, errors } = registry.loadExperiments();

  await runTest("every experiment file loads; the template is ignored", () => {
    assert.deepStrictEqual(errors, []);
    for (const id of ["test-suites", "single-suite", "typecheck", "agent-lab", "image-bakeoff", "eval-gate", "retrieval-eval", "rag-replay"]) assert.ok(experiments.has(id), id);
    assert.ok(!experiments.has("my-feature"), "the _template experiment was loaded");
    for (const e of experiments.values()) registry.describe(e, ctx);
  });

  await runTest("definitions are checked: bad ids, text without a pattern, artifact roots outside lab-out", () => {
    const base = { id: "ok-id", title: "t", group: "g", description: "d", params: [], command: () => ({ args: [] }) };
    assert.ok(registry.checkDefinition(base, "x.cjs"));
    assert.throws(() => registry.checkDefinition({ ...base, id: "../x" }, "x.cjs"), /id must match/);
    assert.throws(() => registry.checkDefinition({ ...base, params: [{ name: "q", type: "text" }] }, "x.cjs"), /needs a pattern/);
    assert.throws(() => registry.checkDefinition({ ...base, artifactRoots: ["src"] }, "x.cjs"), /inside lab-out/);
    assert.throws(() => registry.checkDefinition({ ...base, artifactRoots: ["lab-out/../src"] }, "x.cjs"), /inside lab-out/);
  });

  await runTest("params are validated strictly: unknown keys, ranges, patterns, option lists", () => {
    const agent = experiments.get("agent-lab")!;
    const ok = registry.validate(agent, { faults: "storm", trials: "3" }, ctx);
    assert.deepStrictEqual(ok.errors, []);
    assert.strictEqual(ok.values.trials, 3);
    assert.strictEqual(ok.values.brain, "scripted");
    assert.ok(registry.validate(agent, { shell: "x" }, ctx).errors.some((e) => /unknown param/.test(e)));
    assert.ok(registry.validate(agent, { trials: 99 }, ctx).errors.some((e) => /trials/.test(e)));
    assert.ok(registry.validate(agent, { trials: 1.5 }, ctx).errors.some((e) => /whole number/.test(e)));
    assert.ok(registry.validate(agent, { cases: "G01; rm -rf /" }, ctx).errors.some((e) => /cases/.test(e)));
    assert.ok(registry.validate(agent, { faults: "everything" }, ctx).errors.some((e) => /faults/.test(e)));
    assert.ok(registry.validate(agent, { baseline: "../../etc" }, ctx).errors.some((e) => /baseline/.test(e)));
    assert.ok(registry.validate(experiments.get("test-suites")!, { pg: "yes" }, ctx).errors.some((e) => /pg/.test(e)));
  });

  await runTest("plans are node argument lists; live and image runs are marked paid with a warning", () => {
    const agent = experiments.get("agent-lab")!;
    const scripted = registry.plan(agent, registry.validate(agent, {}, ctx).values, { ...ctx, runId: "r1" });
    assert.strictEqual(scripted.cost, "free");
    assert.deepStrictEqual(scripted.env, {});
    assert.ok(scripted.args.every((a) => typeof a === "string"));
    const live = registry.plan(agent, registry.validate(agent, { brain: "live" }, ctx).values, { ...ctx, runId: "r1" });
    assert.strictEqual(live.cost, "paid");
    assert.strictEqual(live.env.TEST_LLM_LIVE, "1");
    assert.ok(live.warning.length > 0);
    const img = experiments.get("image-bakeoff")!;
    const imgPlan = registry.plan(img, registry.validate(img, { mode: "live" }, ctx).values, { ...ctx, runId: "r2" });
    assert.strictEqual(imgPlan.cost, "paid");
    assert.ok(imgPlan.args.includes("lab-out/image-bakeoff/r2"));
    const single = registry.describe(experiments.get("single-suite")!, ctx);
    assert.ok(single.params[0].options!.includes("tests/lab-console-tests.ts"), "new suites are listed automatically");
  });

  await runTest("the run engine records status, exit code, output, summary and artifacts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-console-"));
    const runs = new RunManager({ root: tmp, jobs: 1 });
    const watched: string[] = [];
    runs.watch((ev, r) => watched.push(`${ev}:${r.status}`));
    const script = "const fs=require('fs');fs.mkdirSync('lab-out/demo',{recursive:true});fs.writeFileSync('lab-out/demo/report.html','<p>x</p>');console.log('cases 3 pass 2');process.exit(3)";
    const run = runs.submit("r-test", { id: "demo", title: "Demo", group: "G", artifactRoots: ["lab-out/demo"] }, { a: 1 }, { args: ["-e", script], env: {}, cost: "free" });
    await new Promise<void>((resolve) => {
      const off = runs.subscribe(run.id, (ev) => {
        if (ev === "end") {
          off();
          resolve();
        }
      });
    });
    const done = runs.get(run.id);
    assert.strictEqual(done.status, "failed");
    assert.strictEqual(done.exit_code, 3);
    assert.match(runs.log(run.id), /cases 3 pass 2/);
    assert.strictEqual(done.summary, "cases 3 pass 2");
    assert.deepStrictEqual(done.artifacts, ["lab-out/demo/report.html"]);
    // The dashboard's live feed: queued, started, finished, end; never the log output
    assert.deepStrictEqual(watched, ["status:queued", "status:running", "status:failed", "end:failed"]);
    // A restart finds the run on disk
    assert.strictEqual(new RunManager({ root: tmp, jobs: 1 }).get(run.id).status, "failed");
    assert.strictEqual(summarizeLog("\x1b[32mTests Passed: 3\x1b[0m\n{\"level\":\"warn\"}\n"), "Tests Passed: 3");
  });

  await runTest("files: only lab-out/ and eval-out/, no traversal, no eval-data", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-files-"));
    fs.mkdirSync(path.join(tmp, "lab-out", "a"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "eval-data"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "lab-out", "a", "r.html"), "x");
    fs.writeFileSync(path.join(tmp, "eval-data", "photo.json"), "{}");
    fs.writeFileSync(path.join(tmp, "secret.json"), "{}");
    assert.ok(safeFile(tmp, "lab-out/a/r.html"));
    assert.strictEqual(safeFile(tmp, "lab-out/../secret.json"), null);
    assert.strictEqual(safeFile(tmp, "lab-out/a/../../secret.json"), null);
    assert.strictEqual(safeFile(tmp, "eval-data/photo.json"), null);
    assert.strictEqual(safeFile(tmp, "secret.json"), null);
    assert.strictEqual(safeFile(tmp, "lab-out/a/r.exe"), null);
  });

  await runTest("server: Host check, token and JSON on writes, strict params, paid confirmation, sandboxed reports, live event feed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-server-"));
    fs.mkdirSync(path.join(tmp, "lab-out", "agent", "x"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "lab-out", "agent", "x", "report.html"), "<p>r</p>");
    const token = "t".repeat(48);
    const lab = createConsole({ root: tmp, port: 0, jobs: 1, token });
    const port = await lab.listen();
    try {
      const json = { "Content-Type": "application/json", "X-Lab-Token": token };
      assert.strictEqual((await request(port, "GET", "/api/experiments", { host: "evil.example:80" })).status, 421);
      const home = await request(port, "GET", "/");
      assert.strictEqual(home.status, 200);
      assert.ok(home.body.includes(token));
      assert.match(String(home.headers["content-security-policy"]), /script-src 'self'/);
      assert.strictEqual((await request(port, "GET", "/api/experiments", { host: `localhost:${port}` })).status, 200);
      const body = JSON.stringify({ experiment: "agent-lab", params: {} });
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: { "Content-Type": "application/json" }, body })).status, 403);
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: { "Content-Type": "application/json", "X-Lab-Token": "x".repeat(48) }, body })).status, 403);
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: { "Content-Type": "text/plain", "X-Lab-Token": token }, body })).status, 415);
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: json, body: JSON.stringify({ experiment: "nope" }) })).status, 404);
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: json, body: JSON.stringify({ experiment: "agent-lab", params: { cmd: "x" } }) })).status, 400);
      assert.strictEqual((await request(port, "POST", "/api/runs", { headers: json, body: "{not json" })).status, 400);
      const paid = await request(port, "POST", "/api/runs", { headers: json, body: JSON.stringify({ experiment: "agent-lab", params: { brain: "live" } }) });
      assert.strictEqual(paid.status, 409);
      const preview = JSON.parse((await request(port, "POST", "/api/preview", { headers: json, body: JSON.stringify({ experiment: "agent-lab", params: { brain: "live" } }) })).body);
      assert.strictEqual(preview.cost, "paid");
      assert.match(preview.command, /^node tests\/ts-runner\.cjs \.\/tests\/lab\/agent-lab\.ts --brain live/);
      const report = await request(port, "GET", "/files?path=lab-out/agent/x/report.html");
      assert.strictEqual(report.status, 200);
      assert.match(String(report.headers["content-security-policy"]), /^sandbox/);
      assert.strictEqual((await request(port, "GET", "/files?path=lab-out/../package.json")).status, 404);
      assert.strictEqual((await request(port, "GET", `/files?path=${encodeURIComponent("lab-out\\..\\x.json")}`)).status, 404);
      const hello = await new Promise<string>((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/api/events", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
          assert.strictEqual(res.headers["content-type"], "text/event-stream");
          res.once("data", (c) => {
            req.destroy();
            resolve(String(c));
          });
        });
        req.on("error", reject);
      });
      assert.strictEqual(hello, 'event: hello\ndata: {"active":[]}\n\n');
      assert.strictEqual((await request(port, "GET", "/api/events", { host: "evil.example:80" })).status, 421);
      const dash = JSON.parse((await request(port, "GET", "/api/dashboard")).body);
      assert.ok(dash.runs && dash.agent && dash.tests && dash.image && dash.rag);
    } finally {
      await lab.close();
    }
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
