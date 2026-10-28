/** All `npm test` suites in parallel (tests/lab/run-suites.cjs): FLAKY vs FAIL, durations, JUnit. */
module.exports = {
  id: "test-suites",
  title: "Test suites (parallel)",
  group: "Tests",
  description: "Runs every npm test suite in parallel child processes, retries failures once to separate FLAKY from FAIL, and records durations.",
  params: [
    { name: "only", label: "Only suites containing", type: "text", default: "", pattern: "^[\\w,.-]{0,200}$", help: "Comma-separated name parts, e.g. rbac,security. Empty = all." },
    { name: "jobs", label: "Parallel jobs", type: "number", default: 4, min: 1, max: 8, integer: true },
    { name: "retries", label: "Retries on failure", type: "number", default: 1, min: 0, max: 2, integer: true },
    { name: "typecheck", label: "Type-check first", type: "bool", default: false },
    { name: "pg", label: "Run on in-memory Postgres (PGlite)", type: "bool", default: false },
  ],
  artifactRoots: ["lab-out/tests"],
  command(v) {
    const args = ["tests/lab/run-suites.cjs", "--jobs", String(v.jobs), "--retries", String(v.retries)];
    if (v.only) args.push("--only", v.only);
    if (v.typecheck) args.push("--typecheck");
    if (v.pg) args.push("--pg");
    return { args };
  },
};
