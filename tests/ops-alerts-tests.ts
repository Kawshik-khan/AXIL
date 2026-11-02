/**
 * Ops alerts (production readiness O6): unhandled 500s are counted, the monitoring job turns its findings into one
 * Telegram message to OPS_ALERTS_CHAT_ID through the alerts bot, repeats are held back, recovery is announced once,
 * and nothing is sent (or claimed) when the chat isn't configured.
 */
import assert from "assert";
import { reportOpsIssues, resetOpsAlertsForTesting, opsAlertsConfigured, type OpsIssue } from "@/domains/notifications/ops-alerts";
import { recordServerError, serverErrorsSince, resetOpsSignalsForTesting } from "@/lib/ops-signals";
import { apiError } from "@/lib/api-response";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { NotFoundError } from "@/lib/errors";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

const sent: Array<{ chat_id: string; text: string }> = [];
let failSend = false;

async function main() {
  console.log(`\n${BOLD}OPS ALERTS (O6)${RESET}\n`);
  setOutboundTransportForTesting(async (url, options) => {
    const method = url.pathname.split("/").pop() ?? "";
    const params = options.body ? JSON.parse(String(options.body)) : {};
    const reply = (status: number, body: Record<string, unknown>) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (method === "sendMessage") {
      if (failSend) return reply(500, { ok: false, error_code: 500, description: "Internal Server Error" });
      sent.push({ chat_id: String(params.chat_id), text: String(params.text) });
    }
    return reply(200, { ok: true, result: true });
  });

  const env = { TELEGRAM_ALERTS_BOT_TOKEN: "123456:ABCdefGhIJKlmNoPQRstuVWxyz0123456789", OPS_ALERTS_CHAT_ID: "-1001234567890", APP_URL: "https://shop.example" } as NodeJS.ProcessEnv;
  process.env.TELEGRAM_ALERTS_BOT_TOKEN = env.TELEGRAM_ALERTS_BOT_TOKEN; // the bot call reads the process environment
  const issue = (key: string, severity: OpsIssue["severity"] = "critical"): OpsIssue => ({ key, title: `Problem ${key}`, severity, detail: "details" });
  const t0 = Date.parse("2026-11-02T10:00:00Z");

  await runTest("unhandled 500s are counted by time window", () => {
    resetOpsSignalsForTesting();
    recordServerError(t0 - 10 * 60_000);
    recordServerError(t0 - 60_000);
    recordServerError(t0);
    assert.strictEqual(serverErrorsSince(t0 - 5 * 60_000), 2);
    assert.strictEqual(serverErrorsSince(t0 - 60 * 60_000), 3);
  });

  await runTest("apiError counts an unexpected error, not a client error", () => {
    resetOpsSignalsForTesting();
    const before = Date.now() - 1000;
    apiError(new Error("boom"));
    assert.strictEqual(serverErrorsSince(before), 1);
    apiError(new NotFoundError("Order"));
    assert.strictEqual(serverErrorsSince(before), 1, "a 404 is not a server error");
  });

  await runTest("not configured: nothing is sent and the result says so", async () => {
    resetOpsAlertsForTesting();
    sent.length = 0;
    assert.strictEqual(opsAlertsConfigured({} as NodeJS.ProcessEnv), false);
    assert.strictEqual(opsAlertsConfigured({ ...env, OPS_ALERTS_CHAT_ID: "not-a-chat" }), false);
    assert.strictEqual(await reportOpsIssues([issue("a")], t0, {} as NodeJS.ProcessEnv), "NOT_CONFIGURED");
    assert.strictEqual(await reportOpsIssues([], t0, {} as NodeJS.ProcessEnv), "HEALTHY");
    assert.strictEqual(sent.length, 0);
  });

  await runTest("an issue is sent once, held back while unchanged, repeated after an hour, sent again when it changes", async () => {
    resetOpsAlertsForTesting();
    sent.length = 0;
    assert.strictEqual(await reportOpsIssues([issue("a")], t0, env), "SENT");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].chat_id, "-1001234567890");
    assert.ok(sent[0].text.includes("Problem a: details"));
    assert.ok(sent[0].text.includes("https://shop.example"));
    assert.strictEqual(await reportOpsIssues([issue("a")], t0 + 5 * 60_000, env), "SUPPRESSED");
    assert.strictEqual(await reportOpsIssues([issue("a")], t0 + 61 * 60_000, env), "SENT", "a reminder after an hour");
    assert.strictEqual(await reportOpsIssues([issue("a"), issue("b", "warning")], t0 + 62 * 60_000, env), "SENT", "a new issue");
    assert.strictEqual(sent.length, 3);
  });

  await runTest("recovery is announced once; a healthy run after that sends nothing", async () => {
    sent.length = 0;
    assert.strictEqual(await reportOpsIssues([], t0 + 70 * 60_000, env), "RESOLVED_SENT");
    assert.ok(sent[0].text.includes("all clear"));
    assert.strictEqual(await reportOpsIssues([], t0 + 75 * 60_000, env), "HEALTHY");
    assert.strictEqual(sent.length, 1);
  });

  await runTest("a failed send is reported as FAILED (never as sent) and retried on the next run", async () => {
    resetOpsAlertsForTesting();
    sent.length = 0;
    failSend = true;
    assert.strictEqual(await reportOpsIssues([issue("c")], t0, env), "FAILED");
    failSend = false;
    assert.strictEqual(await reportOpsIssues([issue("c")], t0 + 5 * 60_000, env), "SENT");
    assert.strictEqual(sent.length, 1);
  });

  setOutboundTransportForTesting(null);
  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
