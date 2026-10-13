const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function usage() {
  console.log("Usage: npm run rag:replay:offline -- [--dataset rag-bn-commerce-v1] [--output <file>] [--no-report] [--json]");
  console.log("       npm run rag:replay:live -- --confirm-live-cost [--dataset rag-bn-commerce-v1] [--output <file>] [--json]");
}

function parseArgs(args) {
  const parsed = { live: false, confirmLiveCost: false, dataset: "rag-bn-commerce-v1", output: "tests/rag-replay-report.json", writeReport: true, printJson: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--live") parsed.live = true;
    else if (arg === "--confirm-live-cost") parsed.confirmLiveCost = true;
    else if (arg === "--no-report") parsed.writeReport = false;
    else if (arg === "--json") parsed.printJson = true;
    else if (arg === "--dataset" || arg === "--output") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--dataset") parsed.dataset = value;
      else parsed.output = value;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (parsed.live && !parsed.confirmLiveCost) throw new Error("Live replay can call a paid provider. Re-run with --confirm-live-cost after approving that call.");
  if (!parsed.live && parsed.confirmLiveCost) throw new Error("--confirm-live-cost is only valid with --live.");
  return parsed;
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(`RAG replay arguments: ${error.message}`);
    usage();
    process.exit(2);
  }

  const childEnv = {
    ...process.env,
    NODE_ENV: "test",
    AI_DEMO_MODE: options.live ? "0" : "1",
    TEST_LLM_LIVE: options.live ? "1" : "0",
    RAG_REPLAY_LIVE: options.live ? "1" : "0",
    RAG_REPLAY_DATASET: options.dataset,
    RAG_REPLAY_OUTPUT: options.writeReport ? path.resolve(process.cwd(), options.output) : "",
    // Always isolate retrieval from hosted Qdrant; even an explicit live embedding replay uses the controlled local corpus.
    QDRANT_URL: "",
    QDRANT_API_KEY: "",
    DATA_BACKEND: "",
    DATABASE_URL: "",
  };
  if (!options.live) {
    for (const key of [
      "LLM_BASE_URL", "LLM_API_KEY", "LLM_PROVIDER_NAME", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY",
      "LLM_EMBEDDING_BASE_URL", "LLM_EMBEDDING_API_KEY", "LLM_EMBEDDING_PROVIDER_NAME", "LLM_EMBEDDING_MODEL", "LLM_EMBEDDING_DIMENSIONS",
    ]) childEnv[key] = "";
  }

  if (options.live) console.warn("LIVE RAG REPLAY: configured embedding provider calls may incur cost; hosted Qdrant and databases remain disabled.");
  const child = spawnSync(process.execPath, [path.join(__dirname, "ts-runner.cjs"), "./tests/rag-replay.ts"], {
    cwd: path.resolve(__dirname, ".."), env: childEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) {
    console.error(`Could not start RAG replay: ${child.error.message}`);
    process.exit(2);
  }

  const stdoutLines = (child.stdout || "").split(/\r?\n/);
  const reportLine = stdoutLines.find((line) => line.startsWith("RAG_REPLAY_JSON "));
  let report;
  if (reportLine) {
    try { report = JSON.parse(reportLine.slice("RAG_REPLAY_JSON ".length)); }
    catch (error) { console.error(`Could not parse RAG replay report: ${error.message}`); process.exit(2); }
  }
  process.stdout.write(stdoutLines.filter((line) => !line.startsWith("RAG_REPLAY_JSON ")).join("\n").trimStart());
  if (report && options.writeReport) {
    try {
      fs.mkdirSync(path.dirname(childEnv.RAG_REPLAY_OUTPUT), { recursive: true });
      fs.writeFileSync(childEnv.RAG_REPLAY_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    } catch (error) {
      console.error(`Could not write RAG replay report: ${error.message}`);
      process.exit(2);
    }
  }
  if (report) {
    if (options.printJson) console.log(JSON.stringify(report, null, 2));
    else console.log(`RAG_REPLAY_SUMMARY ${JSON.stringify({ evaluation_status: "SEED_REGRESSION_ONLY", dataset_version: report.dataset_version, dataset_review_status: report.dataset_review_status, mode: report.mode, provider: report.provider, metrics: report.metrics, gates: report.gates })}`);
    if (options.writeReport) console.log(`RAG replay report: ${path.relative(process.cwd(), childEnv.RAG_REPLAY_OUTPUT)}`);
    if (!report.gates.passed) {
      for (const item of report.cases || []) {
        const reasons = [];
        if (item.expected.answerability === "ANSWERABLE" && !item.actual.released_citations.some((citation) => item.expected.relevant_sections.includes(citation.section))) reasons.push("no relevant citation released");
        if (item.expected.answerability === "ANSWERABLE" && item.actual.unsupported_facts.length) reasons.push(`unsupported facts: ${item.actual.unsupported_facts.join(", ")}`);
        if (["UNANSWERABLE", "CONFLICTING", "STALE"].includes(item.expected.answerability) && !item.actual.abstained) reasons.push("expected abstention");
        if (item.expected.answerability === "RETRIEVAL_UNAVAILABLE" && item.actual.retrieval_outcome !== "RETRIEVAL_UNAVAILABLE") reasons.push("expected retrieval-unavailable outcome");
        if (item.actual.stale_citation_count || item.actual.cross_tenant_citation_count) reasons.push("stale or cross-tenant citation");
        if (reasons.length) console.error(`  ${item.case_id}: ${reasons.join("; ")}`);
      }
    }
  }
  if (process.exitCode !== 2) process.exitCode = child.status === null ? 2 : child.status;
}

main();
