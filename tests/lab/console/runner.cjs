/**
 * Lab console: the run engine. Starts experiments as `node` child processes (no shell) from the repo root, with a
 * concurrency limit and a FIFO queue, streams their output to subscribers, and keeps every run on disk:
 * lab-out/console/runs/<id>/{run.json, output.log}. After a run it links the files the experiment wrote under its
 * artifact roots. Runs found "running" at start-up (the console was stopped) are marked "interrupted".
 */
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ANSI = /\x1b\[[0-9;]*m/g;
const SUMMARY = /(tests passed|suites|pass|fail|cases|safety|precision|recall|error|gate)/i;
const ARTIFACT_EXT = new Set([".html", ".json", ".md", ".xml", ".log", ".jsonl"]);

/** The most informative last line of a log: the runners all end with a summary line. */
function summarizeLog(text) {
  const lines = text.replace(ANSI, "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("{\""));
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) if (SUMMARY.test(lines[i])) return lines[i].slice(0, 240);
  return (lines[lines.length - 1] || "").slice(0, 240);
}

/** Files under the experiment's artifact roots changed since the run started (depth 2), as repo-relative paths. */
function findArtifacts(root, roots, sinceMs) {
  const out = [];
  const walk = (abs, rel, depth) => {
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      if (depth > 2) return;
      for (const f of fs.readdirSync(abs)) walk(path.join(abs, f), `${rel}/${f}`, depth + 1);
    } else if (st.mtimeMs >= sinceMs - 1000 && ARTIFACT_EXT.has(path.extname(abs)) && !rel.includes("/logs/")) {
      out.push(rel);
    }
  };
  for (const r of roots) {
    const abs = path.join(root, r);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) walk(path.join(abs, f), `${r}/${f}`, 1);
  }
  return out.sort().slice(0, 50);
}

class RunManager {
  constructor({ root, jobs = 2 }) {
    this.root = root;
    this.jobs = jobs;
    this.dir = path.join(root, "lab-out", "console", "runs");
    fs.mkdirSync(this.dir, { recursive: true });
    this.runs = new Map();
    this.children = new Map();
    this.queue = [];
    this.listeners = new Map();
    /** Run-level changes (queued, started, ended) for every run: the dashboard's live updates. */
    this.watchers = new Set();
    this.load();
  }

  load() {
    for (const id of fs.readdirSync(this.dir)) {
      const f = path.join(this.dir, id, "run.json");
      if (!fs.existsSync(f)) continue;
      try {
        const run = JSON.parse(fs.readFileSync(f, "utf8"));
        if (run.status === "running" || run.status === "queued") {
          run.status = "interrupted";
          this.save(run);
        }
        this.runs.set(run.id, run);
      } catch {
        /* a half-written run.json: skip it */
      }
    }
  }

  save(run) {
    fs.mkdirSync(path.join(this.dir, run.id), { recursive: true });
    fs.writeFileSync(path.join(this.dir, run.id, "run.json"), JSON.stringify(run, null, 2));
  }

  list() {
    return [...this.runs.values()].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }
  get(id) {
    return this.runs.get(id);
  }
  logPath(id) {
    return path.join(this.dir, id, "output.log");
  }
  log(id) {
    const f = this.logPath(id);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  }

  newId(experimentId) {
    return `${new Date().toISOString().replace(/[:.]/g, "-")}-${experimentId}-${crypto.randomBytes(2).toString("hex")}`;
  }

  /** Queues a run; `planned` is registry.plan()'s output. */
  submit(id, experiment, values, planned) {
    const run = {
      id, experiment: experiment.id, title: experiment.title, group: experiment.group, params: values, cost: planned.cost,
      command: ["node", ...planned.args].join(" "), env_keys: Object.keys(planned.env), status: "queued",
      created_at: new Date().toISOString(), started_at: null, finished_at: null, duration_ms: null, exit_code: null, summary: "", artifacts: [],
    };
    this.runs.set(id, run);
    this.save(run);
    fs.writeFileSync(this.logPath(id), "");
    this.queue.push({ run, planned, roots: experiment.artifactRoots || [] });
    this.emit(id, "status", run);
    this.pump();
    return run;
  }

  pump() {
    while (this.children.size < this.jobs && this.queue.length) this.start(this.queue.shift());
  }

  emit(id, event, data) {
    for (const fn of this.listeners.get(id) || []) fn(event, data);
    if (event !== "log") for (const fn of this.watchers) fn(event, data);
  }
  /** Every run's status and end events (no log output). Returns the unsubscribe function. */
  watch(fn) {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }
  subscribe(id, fn) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    this.listeners.get(id).add(fn);
    return () => this.listeners.get(id)?.delete(fn);
  }

  start({ run, planned, roots }) {
    const t0 = Date.now();
    run.status = "running";
    run.started_at = new Date(t0).toISOString();
    this.save(run);
    this.emit(run.id, "status", run);
    const out = fs.createWriteStream(this.logPath(run.id), { flags: "a" });
    const child = spawn(process.execPath, planned.args, { cwd: this.root, env: { ...process.env, FORCE_COLOR: "0", ...planned.env }, windowsHide: true, detached: process.platform !== "win32" });
    this.children.set(run.id, child);
    const onData = (d) => {
      const text = d.toString();
      out.write(text);
      this.emit(run.id, "log", text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const finish = (code, errText) => {
      if (!this.children.has(run.id)) return;
      this.children.delete(run.id);
      if (errText) onData(`\n[lab console] ${errText}\n`);
      out.end(() => {
        run.finished_at = new Date().toISOString();
        run.duration_ms = Date.now() - t0;
        run.exit_code = code;
        if (run.status !== "cancelled") run.status = code === 0 ? "passed" : "failed";
        run.summary = summarizeLog(this.log(run.id));
        run.artifacts = findArtifacts(this.root, roots, t0);
        this.save(run);
        this.emit(run.id, "status", run);
        this.emit(run.id, "end", run);
        this.pump();
      });
    };
    child.on("error", (err) => finish(1, `could not start: ${err.message}`));
    child.on("close", (code) => finish(code ?? 1));
  }

  cancel(id) {
    const queued = this.queue.findIndex((q) => q.run.id === id);
    if (queued !== -1) {
      const [{ run }] = this.queue.splice(queued, 1);
      run.status = "cancelled";
      run.finished_at = new Date().toISOString();
      this.save(run);
      this.emit(id, "status", run);
      this.emit(id, "end", run);
      return true;
    }
    const child = this.children.get(id);
    if (!child) return false;
    this.runs.get(id).status = "cancelled";
    // Runners start their own children (suites, workers): end the whole tree
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else {
      try {
        process.kill(-child.pid, "SIGTERM"); // its own process group (detached)
      } catch {
        child.kill("SIGTERM");
      }
    }
    return true;
  }

  stopAll() {
    for (const id of this.children.keys()) this.cancel(id);
  }
}

module.exports = { RunManager, summarizeLog, findArtifacts };
