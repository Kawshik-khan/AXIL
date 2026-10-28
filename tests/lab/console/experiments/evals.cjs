/** The router + agent eval gate, the policy-search retrieval eval, and the RAG replay. */
module.exports = [
  {
    id: "eval-gate",
    title: "Eval gate",
    group: "Eval",
    description: "Golden dataset through the router and agent runtime; fails below evals/thresholds.json. Offline uses the demo AI.",
    params: [{ name: "live", label: "Use the live provider", type: "bool", default: false }],
    cost: (v) => (v.live ? "paid" : "free"),
    warning: (v) => (v.live ? "Calls the live model provider." : ""),
    artifactRoots: [],
    command(v) {
      return { args: ["tests/ts-runner.cjs", "./tests/eval-gate.ts"], env: v.live ? { TEST_LLM_LIVE: "1" } : {} };
    },
  },
  {
    id: "retrieval-eval",
    title: "Retrieval eval (policy search)",
    group: "RAG",
    description: "52 queries in English, Banglish and Bangla against the eval shop's policies: Recall@2 per language and how often an irrelevant document ranks first.",
    params: [],
    artifactRoots: [],
    command() {
      return { args: ["tests/ts-runner.cjs", "./tests/agent-evals/retrieval-eval.ts"] };
    },
  },
  {
    id: "rag-replay",
    title: "RAG replay",
    group: "RAG",
    description: "Replays the Bangla commerce RAG dataset and writes a JSON report.",
    params: [{ name: "live", label: "Use the live provider", type: "bool", default: false }],
    cost: (v) => (v.live ? "paid" : "free"),
    warning: (v) => (v.live ? "Can call a paid model provider." : ""),
    artifactRoots: ["lab-out/rag"],
    command(v, { runId }) {
      const args = ["tests/rag-replay.cjs", "--output", `lab-out/rag/${runId}.json`];
      if (v.live) args.push("--live", "--confirm-live-cost");
      return { args };
    },
  },
];
