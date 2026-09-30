/**
 * Access log (production readiness R1): one line per API request in production, and it never carries ids, tokens
 * or the query string. Run: node tests/ts-runner.cjs ./tests/access-log-tests.ts
 */
import assert from "assert";
import { withStore } from "@/lib/store-unit";

let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓ PASS\x1b[0m - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗ FAIL\x1b[0m - ${name}\n      ${(err as Error).message}`);
  }
}

/** Runs fn with process.stdout.write captured; returns the parsed JSON log lines. */
async function captureLog(fn: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = real;
  }
  return lines.flatMap((l) => l.split("\n")).filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
}

const ok = withStore("GET", async () => new Response("{}", { status: 200 }));
const boom = withStore("GET", async () => {
  throw new Error("handler exploded");
});

async function main(): Promise<void> {
  console.log("\n[R1] access log");
  const saved = { node: process.env.NODE_ENV, flag: process.env.ACCESS_LOG };
  const env = process.env as Record<string, string | undefined>;
  try {
    await runTest("production: one http.request line with method, path prefix, status and duration", async () => {
      env.NODE_ENV = "production";
      delete env.ACCESS_LOG;
      const logs = await captureLog(async () => {
        await ok(new Request("http://x/api/v1/orders?search=01712345678&email=a@b.c"));
      });
      const line = logs.find((l) => l.event === "http.request");
      assert.ok(line, "a line was logged");
      assert.strictEqual(line.method, "GET");
      assert.strictEqual(line.path, "/api/v1/orders");
      assert.strictEqual(line.status, 200);
      assert.strictEqual(typeof line.duration_ms, "number");
      assert.ok(!JSON.stringify(line).includes("01712345678") && !JSON.stringify(line).includes("a@b.c"), "no query string");
    });

    await runTest("only /api/v1/<resource> is kept: ids and invitation tokens are cut off", async () => {
      env.NODE_ENV = "production";
      const logs = await captureLog(async () => {
        await ok(new Request("http://x/api/v1/invitations/SECRET-TOKEN-VALUE-1234567890/accept"));
      });
      const line = logs.find((l) => l.event === "http.request");
      assert.strictEqual(line?.path, "/api/v1/invitations");
      assert.ok(!JSON.stringify(logs).includes("SECRET-TOKEN"));
    });

    await runTest("health probes are not logged", async () => {
      env.NODE_ENV = "production";
      const logs = await captureLog(async () => {
        await ok(new Request("http://x/health/ready?scope=core"));
      });
      assert.strictEqual(logs.filter((l) => l.event === "http.request").length, 0);
    });

    await runTest("a handler that throws is logged as 500 and the error still propagates", async () => {
      env.NODE_ENV = "production";
      let thrown = false;
      const logs = await captureLog(async () => {
        try {
          await boom(new Request("http://x/api/v1/customers"));
        } catch {
          thrown = true;
        }
      });
      assert.ok(thrown);
      assert.strictEqual(logs.find((l) => l.event === "http.request")?.status, 500);
    });

    await runTest("ACCESS_LOG=0 turns it off in production; outside production it is off unless ACCESS_LOG=1", async () => {
      env.NODE_ENV = "production";
      env.ACCESS_LOG = "0";
      let logs = await captureLog(async () => void (await ok(new Request("http://x/api/v1/orders"))));
      assert.strictEqual(logs.length, 0);
      env.NODE_ENV = "development";
      delete env.ACCESS_LOG;
      logs = await captureLog(async () => void (await ok(new Request("http://x/api/v1/orders"))));
      assert.strictEqual(logs.length, 0);
      env.ACCESS_LOG = "1";
      logs = await captureLog(async () => void (await ok(new Request("http://x/api/v1/orders"))));
      assert.strictEqual(logs.filter((l) => l.event === "http.request").length, 1);
    });
  } finally {
    if (saved.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.node;
    if (saved.flag === undefined) delete env.ACCESS_LOG;
    else env.ACCESS_LOG = saved.flag;
  }
  console.log(`\n  ACCESS LOG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
