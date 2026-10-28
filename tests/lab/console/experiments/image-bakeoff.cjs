/** Image product-search bake-off (scripts/image-bakeoff.ts, docs/image-bakeoff.md): vision × embedding models. */
module.exports = {
  id: "image-bakeoff",
  title: "Image search bake-off",
  group: "Image",
  description: "Vision × image-embedding pairs on the labelled dataset in eval-data/image-bakeoff: precision@HIGH with its Wilson lower bound, coverage, latency. Run 'init-sample' first to create a small synthetic dataset.",
  params: [
    { name: "mode", label: "Mode", type: "select", options: ["mock", "init-sample", "live"], default: "mock", help: "live sends dataset images to the hosts in bakeoff.config.json" },
    { name: "target", label: "Target precision@HIGH", type: "number", default: 0.95, min: 0.5, max: 1 },
    { name: "minHigh", label: "Minimum HIGH answers", type: "number", default: 10, min: 1, max: 10000, integer: true },
    { name: "concurrency", label: "Concurrency", type: "number", default: 2, min: 1, max: 16, integer: true },
    { name: "noCache", label: "Ignore cached provider results", type: "bool", default: false },
    { name: "gate", label: "Fail when no pair meets the target", type: "bool", default: false },
  ],
  cost: (v) => (v.mode === "live" ? "paid" : "free"),
  warning: (v) => (v.mode === "live" ? "Sends the dataset images (metadata removed) to the vision and embedding providers in the config. Use only images you may share with them." : ""),
  artifactRoots: ["lab-out/image-bakeoff"],
  command(v, { runId }) {
    if (v.mode === "init-sample") return { args: ["tests/ts-runner.cjs", "./scripts/image-bakeoff.ts", "--init-sample"] };
    const args = ["tests/ts-runner.cjs", "./scripts/image-bakeoff.ts", `--${v.mode}`, "--out", `lab-out/image-bakeoff/${runId}`, "--target", String(v.target), "--min-high", String(v.minHigh), "--concurrency", String(v.concurrency)];
    if (v.noCache) args.push("--no-cache");
    if (v.gate) args.push("--gate");
    return { args };
  },
};
