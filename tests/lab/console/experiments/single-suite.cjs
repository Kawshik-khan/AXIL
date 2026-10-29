/** One test suite: the quickest way to exercise a new feature's tests from the console. */
const fs = require("fs");
const path = require("path");

function suites(root) {
  const out = [];
  if (!fs.existsSync(path.join(root, "tests"))) return out;
  for (const f of fs.readdirSync(path.join(root, "tests"))) if (/-tests\.ts$/.test(f)) out.push(`tests/${f}`);
  for (const f of ["tests/agent-evals/retrieval-eval.ts"]) if (fs.existsSync(path.join(root, f))) out.push(f);
  return out.sort();
}

module.exports = {
  id: "single-suite",
  title: "Single test suite",
  group: "Tests",
  description: "Runs one suite from tests/ (every *-tests.ts file is listed, new ones included). Use it to test a new feature while you build it.",
  params: [
    { name: "suite", label: "Suite", type: "select", options: ({ root }) => suites(root), required: true },
    { name: "pg", label: "Run on in-memory Postgres (PGlite)", type: "bool", default: false },
  ],
  artifactRoots: [],
  command(v) {
    return { args: ["tests/ts-runner.cjs", `./${v.suite}`], env: v.pg ? { COMMERCEOS_TEST_PG: "1" } : {} };
  },
};
