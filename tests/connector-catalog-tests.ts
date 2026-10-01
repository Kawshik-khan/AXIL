/**
 * Connector catalog characterization (connector plan C0, docs/connector-implementation-plan.md).
 * Pins the provider list, categories, field definitions and the set of providers with a live check, so refactoring the
 * catalog into manifests cannot change behavior unnoticed. A deliberate catalog change updates the snapshot:
 *   UPDATE_SNAPSHOT=1 node tests/ts-runner.cjs ./tests/connector-catalog-tests.ts
 * Run: node tests/ts-runner.cjs ./tests/connector-catalog-tests.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { ConnectorService } from "@/domains/connectors/service";
import { LIVE_CHECK_PROVIDERS } from "@/domains/connectors/live-checks";

const SNAPSHOT = path.join(process.cwd(), "tests", "fixtures", "connector-catalog.snapshot.json");

function currentSnapshot() {
  return {
    providers: ConnectorService.PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: (p as { status?: string }).status ?? null,
      default_endpoint: p.default_endpoint ?? null,
      fields: p.fields.map((f) => ({ name: f.name, type: f.type, required: f.required === true, has_default: f.defaultValue !== undefined })),
    })),
    live_check_providers: [...LIVE_CHECK_PROVIDERS].sort(),
  };
}

let passed = 0;
let failed = 0;
function runTest(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓ PASS\x1b[0m - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗ FAIL\x1b[0m - ${name}\n      ${(err as Error).message.split("\n").slice(0, 12).join("\n      ")}`);
  }
}

console.log("\n[C0] connector catalog");
if (process.env.UPDATE_SNAPSHOT === "1") {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(currentSnapshot(), null, 2) + "\n");
  console.log("  snapshot written");
}

runTest("the catalog (ids, categories, status, fields, live-check set) matches the committed snapshot", () => {
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  assert.deepStrictEqual(currentSnapshot(), expected);
});

runTest("provider ids are unique", () => {
  const ids = ConnectorService.PROVIDERS.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

runTest("no provider field ships a default that looks like a secret (password fields have no defaultValue)", () => {
  for (const p of ConnectorService.PROVIDERS) {
    for (const f of p.fields) {
      assert.ok(!(f.type === "password" && f.defaultValue !== undefined), `${p.id}.${f.name} is a password field with a default`);
    }
  }
});

console.log(`\n  CONNECTOR CATALOG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
process.exit(failed > 0 ? 1 : 0);
