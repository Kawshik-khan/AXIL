import assert from "assert";
import { hasTransientProviderError, type TurnRecord } from "./agent-evals/harness";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(error);
    failed++;
  }
}

function turn(error?: string): Pick<TurnRecord, "error"> {
  return { error };
}

async function main() {
  await runTest("detects provider timeout signatures", () => {
    assert.strictEqual(
      hasTransientProviderError([
        turn("LLM_PROVIDER_ERROR: AI provider ollama-cloud timed out."),
      ]),
      true,
    );
    assert.strictEqual(
      hasTransientProviderError([turn("network TIMEOUT while calling provider")]),
      true,
    );
  });

  await runTest("ignores non-provider failures", () => {
    assert.strictEqual(
      hasTransientProviderError([turn("AI_TOOL_VALIDATION_FAILED: malformed JSON")]),
      false,
    );
    assert.strictEqual(hasTransientProviderError([turn(undefined)]), false);
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
