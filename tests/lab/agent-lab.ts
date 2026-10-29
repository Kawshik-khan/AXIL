/**
 * Agent lab: runs the golden and red-team cases through the production customer-agent runtime as an experiment —
 * a model ("brain"), a fault profile, k trials per case — and records reliability (pass@1 with a 95% interval, pass@k,
 * pass^k), safety invariants under faults, latency, tokens and cost. Optionally compares the run with a baseline run.
 *
 *   node tests/ts-runner.cjs ./tests/lab/agent-lab.ts --faults hostile --trials 3
 *   node tests/ts-runner.cjs ./tests/lab/agent-lab.ts --faults storm --seed 7 --baseline lab-out/agent/<run>
 *   TEST_LLM_LIVE=1 LLM_BASE_URL=… node tests/ts-runner.cjs ./tests/lab/agent-lab.ts --brain live --trials 3   (costs money)
 *
 * Flags: --brain scripted|live  --faults none|flaky|hostile|storm|outage|"timeout=0.2,invented_price=0.5"
 *        --trials k  --seed n  --suites golden,redteam  --cases G01,R06  --limit n  --label text  --baseline <run dir>
 *        --gate (exit 1 on a pass^k regression against the baseline as well as on any safety violation)
 *
 * Isolation is the harness's: in-memory store rebuilt per case (NODE_ENV=test), local hashing embedder, one request at a
 * time, and the circuit breaker reset per trial so one case's faults don't decide the next case's provider.
 * Output: lab-out/agent/<run>/{results.json, report.html}; every run is appended to lab-out/agent/ledger.jsonl.
 */
import fs from "fs";
import path from "path";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { LLMProvider } from "@/domains/ai/providers/llm-provider.interface";
import { RecordingProvider, loadCases, localEmbedder, runCase, runStamp, summarize, type CaseResult } from "../agent-evals/harness";
import { ChaosProvider, ScriptedCustomerModel, parseFaultProfile } from "./chaos-provider";
import { compareRuns, labSummary, toLabCase, toTrial, type Comparison, type LabCase, type LabSummary } from "./lab-metrics";
import { renderReport } from "./lab-report";

export const LAB_DIR = path.join(process.cwd(), "lab-out", "agent");

function args(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "1";
    else flags[a.slice(2)] = argv[++i];
  }
  return flags;
}

async function main() {
  const f = args(process.argv.slice(3));
  const brain = f.brain || "scripted";
  const faultSpec = f.faults || "none";
  const profile = parseFaultProfile(faultSpec);
  const trials = Math.max(1, Math.min(20, Number(f.trials) || 1));
  const seed = Number(f.seed) || 42;
  const suites = (f.suites || "golden,redteam").split(",");
  const only = f.cases ? new Set(f.cases.split(",")) : null;
  const limit = Number(f.limit) || Infinity;

  let inner: LLMProvider;
  let modelName: string;
  if (brain === "live") {
    if (!(process.env.TEST_LLM_LIVE === "1" && process.env.LLM_BASE_URL)) {
      console.error("--brain live needs TEST_LLM_LIVE=1 and a provider profile (LLM_BASE_URL, LLM_MODEL_FAST). It costs money.");
      process.exit(2);
    }
    modelName = modelRouter.resolveModelName("TIER_1_FAST");
    inner = (modelRouter as unknown as { primaryProvider: LLMProvider }).primaryProvider;
    try {
      await inner.chat([{ role: "user", content: "Reply with: ok" }], undefined, { max_tokens: 64, timeout_ms: 60_000 });
    } catch (err) {
      console.error(`LAB ABORTED: the model provider didn't answer a one-line test call (${(err as Error).message}).`);
      process.exit(1);
    }
  } else if (brain === "scripted") {
    inner = new ScriptedCustomerModel(localEmbedder);
    modelName = "lab-scripted";
  } else {
    console.error(`unknown --brain "${brain}" (scripted | live)`);
    process.exit(2);
  }
  const chaos = new ChaosProvider(inner, profile, seed);
  modelRouter.setPrimaryProvider(new RecordingProvider(chaos));
  modelRouter.setFallbackProvider(null);
  if (!(brain === "live" && process.env.EVAL_REAL_EMBEDDINGS === "1" && process.env.LLM_EMBEDDING_BASE_URL)) {
    (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = localEmbedder;
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${brain}-${faultSpec.replace(/[^\w]+/g, "_").slice(0, 40)}`;
  const outDir = path.join(LAB_DIR, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = runStamp(modelName);
  const meta = { run: runId, label: f.label || "", brain, faults: faultSpec, profile, trials, seed, suites, ...stamp, prompt_version: stamp.prompt_version, git_sha: stamp.git_sha, dataset_sha256: stamp.dataset_sha256 };
  console.log(`agent lab ${runId}\n  brain=${brain} faults=${faultSpec} trials=${trials} seed=${seed}`);

  const t0 = Date.now();
  const cases: LabCase[] = [];
  const firstTrials: CaseResult[] = [];
  for (const suite of suites) {
    for (const c of loadCases(suite, only, limit)) {
      const ts = [];
      for (let k = 0; k < trials; k++) {
        modelRouter.resetCircuitBreakers();
        chaos.setScope(`${suite}/${c.id}#${k}`);
        const r = await runCase(suite, c);
        if (k === 0) firstTrials.push(r);
        ts.push(toTrial(r, chaos.take().map((e) => e.kind)));
      }
      const lc = toLabCase(c.id, suite, c.category, ts);
      cases.push(lc);
      const marks = ts.map((t) => (t.violated.length ? "!" : t.pass ? "+" : "-")).join("");
      const note: string[] = [...ts.flatMap((t) => t.violated), ...(lc.pass_hat_k ? [] : ts.find((t) => !t.pass)?.failures.slice(0, 1) ?? [])];
      console.log(`  ${marks.padEnd(Math.max(3, trials))} ${suite}/${c.id} ${note.join(" | ").slice(0, 160)}`);
    }
  }

  const summary: LabSummary = labSummary(cases);
  const quality = Object.fromEntries(suites.map((s) => [s, summarize(firstTrials.filter((r) => r.suite === s))]));
  let comparison: Comparison | undefined;
  if (f.baseline) {
    const base = JSON.parse(fs.readFileSync(path.join(f.baseline, "results.json"), "utf8")) as { meta: { run: string }; cases: LabCase[]; summary: LabSummary };
    comparison = compareRuns(base.meta.run, base.cases, cases, base.summary, summary);
  }
  const result = { meta: { ...meta, duration_ms: Date.now() - t0 }, summary, quality, comparison, cases };
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(result, null, 2));

  fs.mkdirSync(LAB_DIR, { recursive: true });
  const ledger = path.join(LAB_DIR, "ledger.jsonl");
  fs.appendFileSync(ledger, JSON.stringify({ run: runId, label: meta.label, brain, faults: faultSpec, trials, seed, prompt_version: meta.prompt_version, git_sha: meta.git_sha, dataset_sha256: meta.dataset_sha256, ...pick(summary) }) + "\n");
  const history = fs.readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>).slice(-30);
  fs.writeFileSync(path.join(outDir, "report.html"), renderReport(result, history));

  console.log(`\n  cases ${summary.cases} × ${trials} trials  pass@1 ${summary.pass_at_1}% [${summary.pass_at_1_ci95?.low}–${summary.pass_at_1_ci95?.high}]  pass@k ${summary.pass_at_k}%  pass^k ${summary.pass_hat_k}%`);
  if (brain !== "live") console.log("  (scripted model: pass rates measure plumbing only; tokens and cost are not real usage)");
  console.log(`  safety ${summary.safety_rate}%  violations ${JSON.stringify(summary.invariant_violations)}`);
  console.log(`  faults ${JSON.stringify(summary.faults)}`);
  if (comparison) console.log(`  vs ${comparison.baseline}: regressed ${comparison.regressed.length}, fixed ${comparison.fixed.length}, newly unsafe ${comparison.newly_unsafe.length}`);
  console.log(`  report: ${path.join(outDir, "report.html")}`);

  const unsafe = Object.keys(summary.invariant_violations).length > 0;
  const regressed = Boolean(f.gate && comparison && (comparison.regressed.length || comparison.newly_unsafe.length));
  if (unsafe) console.error("\n  LAB FAILED: a safety invariant broke (see report)");
  if (regressed) console.error("\n  LAB GATE FAILED: regressions against the baseline");
  process.exit(unsafe || regressed ? 1 : 0);
}

function pick(s: LabSummary) {
  const { pass_at_1, pass_at_k, pass_hat_k, safety_rate, p95_case_latency_ms, avg_tokens_per_case, cost_per_case_usd, cases, trials } = s;
  return { cases, trial_count: trials, pass_at_1, pass_at_k, pass_hat_k, safety_rate, p95_case_latency_ms, avg_tokens_per_case, cost_per_case_usd, violations: Object.values(s.invariant_violations).reduce((n, x) => n + (x ?? 0), 0) };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
