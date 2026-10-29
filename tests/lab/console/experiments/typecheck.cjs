/** TypeScript over the app (the same check as npm run type-check). */
module.exports = {
  id: "typecheck",
  title: "Type-check",
  group: "Build",
  description: "tsc --noEmit over the app. Must stay at 0 errors.",
  params: [{ name: "tests", label: "Check the tests/ config instead", type: "bool", default: false }],
  artifactRoots: [],
  command(v) {
    return { args: ["node_modules/typescript/lib/tsc.js", "--noEmit", ...(v.tests ? ["-p", "tests/tsconfig.json"] : [])] };
  },
};
