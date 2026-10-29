/** Customer agent experiments (tests/lab/agent-lab.ts): model × fault profile × trials, with an optional baseline. */
const fs = require("fs");
const path = require("path");

const runs = ({ root }) => {
  const dir = path.join(root, "lab-out", "agent");
  if (!fs.existsSync(dir)) return [""];
  return ["", ...fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "results.json"))).sort().reverse().map((d) => `lab-out/agent/${d}`)];
};

module.exports = {
  id: "agent-lab",
  title: "Agent model harness",
  group: "Agent",
  description: "Golden + red-team cases through the production customer-agent runtime: pass@1 (95% CI), pass@k, pass^k, safety invariants under injected faults, baseline comparison.",
  params: [
    { name: "brain", label: "Model", type: "select", options: ["scripted", "live"], default: "scripted", help: "live = the configured LLM provider (costs money)" },
    { name: "faults", label: "Fault profile", type: "select", options: ["none", "flaky", "hostile", "storm", "outage"], default: "none" },
    { name: "trials", label: "Trials per case (k)", type: "number", default: 1, min: 1, max: 10, integer: true },
    { name: "seed", label: "Seed", type: "number", default: 42, min: 1, max: 1000000, integer: true },
    { name: "suites", label: "Case suites", type: "select", options: ["golden,redteam", "golden", "redteam"], default: "golden,redteam" },
    { name: "cases", label: "Only cases", type: "text", default: "", pattern: "^[A-Za-z0-9,]{0,300}$", help: "e.g. G01,R06. Empty = all." },
    { name: "limit", label: "Max cases per suite (0 = all)", type: "number", default: 0, min: 0, max: 500, integer: true },
    { name: "label", label: "Label", type: "text", default: "", pattern: "^[\\w .:-]{0,60}$" },
    { name: "baseline", label: "Compare with baseline run", type: "select", options: runs, default: "" },
    { name: "gate", label: "Fail on regressions vs baseline", type: "bool", default: false },
  ],
  cost: (v) => (v.brain === "live" ? "paid" : "free"),
  warning: (v) => (v.brain === "live" ? "Calls the live model provider for every case and trial." : ""),
  artifactRoots: ["lab-out/agent"],
  command(v) {
    const args = ["tests/ts-runner.cjs", "./tests/lab/agent-lab.ts", "--brain", v.brain, "--faults", v.faults, "--trials", String(v.trials), "--seed", String(v.seed), "--suites", v.suites];
    if (v.cases) args.push("--cases", v.cases);
    if (v.limit) args.push("--limit", String(v.limit));
    if (v.label) args.push("--label", v.label);
    if (v.baseline) args.push("--baseline", v.baseline);
    if (v.gate) args.push("--gate");
    return { args, env: v.brain === "live" ? { TEST_LLM_LIVE: "1" } : {} };
  },
};
