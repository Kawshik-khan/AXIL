/**
 * Live agent eval (FX-80): golden + red-team cases against whatever provider profile the environment configures.
 * Costs money; never part of `npm test` (the offline plumbing suite is `tests/agent-evals-offline-tests.ts`).
 *
 *   TEST_LLM_LIVE=1 LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL_FAST=… node tests/ts-runner.cjs ./tests/agent-evals/run-evals.ts
 *   node tests/agent-evals/check-thresholds.mjs "$(ls -d tests/agent-evals/results/live-* | tail -1)"
 * Filters: EVAL_SUITES=golden,redteam  EVAL_CASES=G01,R06  EVAL_LIMIT=5
 *
 * Isolation: in-memory store (NODE_ENV=test); every external service except the model is off. Embeddings use a local
 * hashing embedder unless EVAL_REAL_EMBEDDINGS=1 with LLM_EMBEDDING_BASE_URL. The harness sends one request at a time.
 * Results: tests/agent-evals/results/live-<run>/{summary.json, agent-<suite>.json}
 */
import fs from "fs";
import path from "path";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { LLMProvider } from "@/domains/ai/providers/llm-provider.interface";
import { EVAL_DIR, RecordingProvider, loadCases, localEmbedder, runCase, runStamp, summarize, type CaseResult } from "./harness";

const LIVE = process.env.TEST_LLM_LIVE === "1" && Boolean(process.env.LLM_BASE_URL);

async function main() {
  if (!LIVE) {
    console.error("The live eval needs TEST_LLM_LIVE=1 and a provider profile (LLM_BASE_URL, LLM_MODEL_FAST). For the offline suite run tests/agent-evals-offline-tests.ts.");
    process.exit(2);
  }
  const suites = (process.env.EVAL_SUITES || "golden,redteam").split(",");
  const only = process.env.EVAL_CASES ? new Set(process.env.EVAL_CASES.split(",")) : null;
  const limit = Number(process.env.EVAL_LIMIT) || Infinity;

  // The router was configured from the environment at import; wrap its provider so every call is recorded
  const live = (modelRouter as unknown as { primaryProvider: LLMProvider }).primaryProvider;
  modelRouter.setPrimaryProvider(new RecordingProvider(live));
  modelRouter.setFallbackProvider(null);
  if (!(process.env.EVAL_REAL_EMBEDDINGS === "1" && process.env.LLM_EMBEDDING_BASE_URL)) {
    (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = localEmbedder;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(EVAL_DIR, "results", `live-${runId}`);
  fs.mkdirSync(outDir, { recursive: true });
  const meta = { run: runId, provider: process.env.LLM_PROVIDER_NAME || new URL(process.env.LLM_BASE_URL!).host, ...runStamp(modelRouter.resolveModelName("TIER_1_FAST")) };
  console.log(JSON.stringify(meta));

  const summary: Record<string, unknown> = { meta };
  for (const suite of suites) {
    const results: CaseResult[] = [];
    for (const c of loadCases(suite, only, limit)) {
      const r = await runCase(suite, c);
      results.push(r);
      console.log(`${c.id} ${r.pass ? "PASS" : "FAIL"} ${r.failures.join(" | ").slice(0, 220)}`);
      fs.writeFileSync(path.join(outDir, `agent-${suite}.json`), JSON.stringify({ meta, results }, null, 2));
      summary[`agent/${suite}`] = summarize(results);
      fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(`results: ${outDir}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
