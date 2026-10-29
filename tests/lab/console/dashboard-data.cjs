/**
 * Lab console: the dashboard's numbers, read from what the harnesses already write. Nothing here computes a metric of
 * its own: it collects the latest result files, so the dashboard shows exactly what the runs reported.
 * - agent:  lab-out/agent/ledger.jsonl (one line per agent-lab run)
 * - tests:  lab-out/tests/<run>/report.json (parallel suite runs)
 * - image:  lab-out/image-bakeoff/<run>/report.json and eval-out/image-bakeoff/<run>/report.json
 * - rag:    lab-out/rag/<run>.json, else tests/rag-replay-report.json; tests/agent-evals/results/retrieval-offline.json
 * - runs:   the console's own run records
 */
const fs = require("fs");
const path = require("path");

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join("/");

/** Sub-directories (or files) of `dir`, newest name last; names start with an ISO timestamp. */
function entries(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(filter).sort();
}

function agent(root) {
  const f = path.join(root, "lab-out", "agent", "ledger.jsonl");
  if (!fs.existsSync(f)) return { runs: [] };
  const runs = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean).slice(-40);
  const reports = Object.fromEntries(runs.map((r) => [r.run, fs.existsSync(path.join(root, "lab-out", "agent", r.run, "report.html")) ? `lab-out/agent/${r.run}/report.html` : null]));
  return { runs: runs.map((r) => ({ ...r, report: reports[r.run] })) };
}

function tests(root) {
  const dir = path.join(root, "lab-out", "tests");
  const reports = entries(dir).map((d) => ({ d, r: readJson(path.join(dir, d, "report.json")) })).filter((x) => x.r);
  const history = reports.slice(-15).map(({ d, r }) => ({ run: d, pass: r.pass, flaky: r.flaky, fail: r.fail, wall_ms: r.wall_ms, serial_ms: r.serial_ms, suites: r.suites.length, junit: `lab-out/tests/${d}/junit.xml` }));
  // The latest run that covered most suites, so a one-suite run doesn't hide the full picture
  const full = [...reports].reverse().find(({ r }) => r.suites.length >= 20) || reports[reports.length - 1];
  return {
    history,
    latest: full ? { run: full.d, wall_ms: full.r.wall_ms, suites: full.r.suites.map((s) => ({ suite: s.suite, status: s.status, ms: s.ms, passed: s.passed, failed: s.failed, first_failure: s.first_failure, log: `lab-out/tests/${full.d}/logs/${s.suite}.log` })) } : null,
  };
}

function image(root) {
  const found = [];
  for (const base of ["lab-out", "eval-out"]) {
    const dir = path.join(root, base, "image-bakeoff");
    for (const d of entries(dir)) {
      const f = path.join(dir, d, "report.json");
      if (fs.existsSync(f)) found.push({ d, f, mtime: fs.statSync(f).mtimeMs });
    }
  }
  found.sort((a, b) => a.mtime - b.mtime);
  const runs = found.slice(-10).map(({ d, f }) => {
    const r = readJson(f) || {};
    const combos = (r.combos || []).map((c) => ({
      vision: c.vision_id, embedding: c.embedding_id, meets_target: Boolean(c.meets_target),
      precision: c.metrics?.high?.precision ?? null, precision_lower_95: c.metrics?.high?.precision_lower_95 ?? null,
      coverage: c.metrics?.high?.coverage ?? null, high_count: c.metrics?.high?.count ?? null, p95_ms: c.metrics?.latency_ms?.parallel?.p95 ?? null,
    }));
    return { run: d, mock: Boolean(r.mock) || d.startsWith("mock-"), warnings: (r.warnings || []).slice(0, 5), combos, report: rel(root, f.replace(/report\.json$/, "report.md")) };
  });
  return { runs };
}

function rag(root) {
  const dir = path.join(root, "lab-out", "rag");
  const files = entries(dir, (f) => f.endsWith(".json")).map((f) => path.join(dir, f));
  const fallback = path.join(root, "tests", "rag-replay-report.json");
  const latestFile = files.length ? files[files.length - 1] : fs.existsSync(fallback) ? fallback : null;
  const r = latestFile ? readJson(latestFile) : null;
  const m = r?.metrics || {};
  const retrieval = readJson(path.join(root, "tests", "agent-evals", "results", "retrieval-offline.json"));
  return {
    replay: r ? {
      file: rel(root, latestFile), mode: r.mode, dataset: r.dataset_version, started_at: r.started_at, review_status: r.dataset_review_status,
      metrics: { cases: m.cases, recall_at_5: m.recall_at_5, mrr: m.mrr, ndcg_at_5: m.ndcg_at_5, citation_support_rate: m.citation_support_rate, critical_fact_exactness: m.critical_fact_exactness, false_answer_count: m.false_answer_count, cross_tenant_leak_count: m.cross_tenant_leak_count },
    } : null,
    retrieval: retrieval ? { embeddings: retrieval.embeddings, queries: retrieval.queries, recall_at_2_by_language: retrieval.recall_at_2_by_language, irrelevant_ranked_first: retrieval.irrelevant_ranked_first } : null,
  };
}

function runStats(runs) {
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, passed: 0, failed: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  for (const r of runs) {
    const day = byDay.get((r.created_at || "").slice(0, 10));
    if (!day) continue;
    if (r.status === "passed") day.passed++;
    else if (["failed", "interrupted", "cancelled"].includes(r.status)) day.failed++;
  }
  const latestByExperiment = {};
  for (const r of runs) if (!latestByExperiment[r.experiment]) latestByExperiment[r.experiment] = { id: r.id, status: r.status, created_at: r.created_at, summary: r.summary };
  const count = (s) => runs.filter((r) => r.status === s).length;
  return { total: runs.length, passed: count("passed"), failed: count("failed"), running: count("running") + count("queued"), days, latestByExperiment };
}

function dashboard(root, runs) {
  return { generated_at: new Date().toISOString(), runs: runStats(runs), agent: agent(root), tests: tests(root), image: image(root), rag: rag(root) };
}

module.exports = { dashboard };
