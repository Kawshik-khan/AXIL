/**
 * Template for a new lab experiment. Copy this file to `<your-feature>.cjs` in this folder (files starting with "_" are
 * ignored) and restart the console: it appears under its group with a form built from `params`.
 *
 * Rules the registry enforces:
 * - `command` returns arguments for `node` (no shell). Values come from validated params only.
 * - params: select (options: array, or ({ root }) => array), number (min, max, integer), bool, text (pattern required).
 * - `cost` returns "paid" for anything that calls a paid or external service; the console asks before running it.
 * - Write outputs under one of `artifactRoots` (inside lab-out/) so the run page links them.
 */
module.exports = {
  id: "my-feature",
  title: "My feature harness",
  group: "Features",
  description: "What this measures, and what a pass means.",
  params: [
    { name: "mode", label: "Mode", type: "select", options: ["offline", "live"], default: "offline" },
    { name: "limit", label: "Max cases", type: "number", default: 20, min: 1, max: 500, integer: true },
  ],
  cost: (v) => (v.mode === "live" ? "paid" : "free"),
  artifactRoots: ["lab-out/my-feature"],
  command(v, { runId }) {
    return { args: ["tests/ts-runner.cjs", "./tests/my-feature-tests.ts", "--limit", String(v.limit), "--out", `lab-out/my-feature/${runId}`] };
  },
};
