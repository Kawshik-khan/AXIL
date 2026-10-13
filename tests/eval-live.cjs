// Explicit opt-in wrapper: unlike CI's offline eval gate, this path invokes the configured provider and may incur cost.
process.env.TEST_LLM_LIVE = "1";
process.argv[2] = "./tests/eval-gate.ts";
require("./ts-runner.cjs");
