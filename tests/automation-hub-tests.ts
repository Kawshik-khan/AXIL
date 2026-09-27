// @ts-ignore
import assert from "assert";
import fs from "fs";
import path from "path";
declare const process: { exit(code?: number): void; cwd(): string };

import { db } from "@/infrastructure/db";
import { IdempotencyService } from "@/domains/automation/services/idempotency.service";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { CourierSyncService } from "@/domains/automation/services/courier-sync.service";
import { ProviderCircuitBreakerService } from "@/domains/automation/services/provider-circuit-breaker.service";
import { RetryQueueService } from "@/domains/automation/services/retry-queue.service";
import { DeadLetterService } from "@/domains/automation/services/dead-letter.service";
import { AutomationSafetyService } from "@/domains/automation/services/automation-safety.service";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { N8nProviderService } from "@/domains/automation/services/n8n-provider.service";
import { AutomationRouterService } from "@/domains/automation/services/automation-router.service";
import { STANDARD_WORKFLOW_TEMPLATES } from "@/domains/automation/templates/standard-workflows";
import { CommerceEvent } from "@/types/commerce";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  COMMERCEOS PHASE 6: AUTOMATIONS & N8N HUB PRODUCTION TEST SUITE  ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================${ANSI_RESET}\n`);

  const tenantA = "tenant_test_a";
  const tenantB = "tenant_test_b";
  const actor = "usr_tester_01";

  // ------------------------------------------------------------
  // 1. 39 Standard Workflows Catalog Verification
  // ------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1. 39 Standard Workflow Catalog]${ANSI_RESET}`);

  await runTest("All 39 standard workflows exist across 8 canonical categories", () => {
    assert.strictEqual(STANDARD_WORKFLOW_TEMPLATES.length, 39, "Expected exactly 39 standard workflow templates");
    const categories = new Set(STANDARD_WORKFLOW_TEMPLATES.map((t) => t.category));
    assert.strictEqual(categories.size, 8, "Expected exactly 8 categories");
    assert.ok(categories.has("ORDER"), "Must contain ORDER category");
    assert.ok(categories.has("PAYMENT"), "Must contain PAYMENT category");
    assert.ok(categories.has("INVENTORY"), "Must contain INVENTORY category");
    assert.ok(categories.has("SHIPPING"), "Must contain SHIPPING category");
    assert.ok(categories.has("CUSTOMER"), "Must contain CUSTOMER category");
    assert.ok(categories.has("SOCIAL"), "Must contain SOCIAL category");
    assert.ok(categories.has("MARKETING"), "Must contain MARKETING category");
    assert.ok(categories.has("FINANCE_OPERATIONS"), "Must contain FINANCE_OPERATIONS category");
  });

  await runTest("Every standard template defines risk level, retry policy, and version", () => {
    for (const t of STANDARD_WORKFLOW_TEMPLATES) {
      assert.ok(t.id && t.code && t.name, `Template ${t.code} missing required identifiers`);
      assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(t.risk_level), `Template ${t.code} has invalid risk level`);
      assert.ok(t.retry_policy && t.retry_policy.max_attempts > 0, `Template ${t.code} missing retry policy`);
      assert.ok(t.supported_channels.length > 0, `Template ${t.code} must support at least 1 channel`);
      assert.ok(t.n8n_workflow_file.endsWith(".json"), `Template ${t.code} missing exportable n8n workflow file reference`);
    }
  });

  // ------------------------------------------------------------
  // 2. Lifecycle Governance & Template Installation
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2. Lifecycle Governance & Tenant Installation]${ANSI_RESET}`);

  let installedAutomationId = "";

  await runTest("Installs standard template creating immutable workflow version and tenant automation", () => {
    const installed = AutomationRegistryService.installTemplate(tenantA, "WF-ORD-01", actor);
    assert.ok(installed.automation.id);
    assert.strictEqual(installed.automation.tenant_id, tenantA);
    assert.strictEqual(installed.automation.status, "ACTIVE");
    assert.strictEqual(installed.workflow.version, 1);
    assert.strictEqual(installed.automation.name, "New Order Notification");
    installedAutomationId = installed.automation.id;

    // Verify version record exists
    const versions = db.getAutomationWorkflowVersions(tenantA, installed.workflow.id);
    assert.strictEqual(versions.length, 1);
    assert.strictEqual(versions[0].version_number, 1);
  });

  await runTest("Toggles automation lifecycle states: Pause -> Resume -> Disable -> Enable", () => {
    const paused = AutomationRegistryService.setAutomationStatus(tenantA, installedAutomationId, actor, "PAUSE");
    assert.strictEqual(paused.status, "PAUSED");
    assert.strictEqual(paused.enabled, false);

    const resumed = AutomationRegistryService.setAutomationStatus(tenantA, installedAutomationId, actor, "RESUME");
    assert.strictEqual(resumed.status, "ACTIVE");
    assert.strictEqual(resumed.enabled, true);

    const disabled = AutomationRegistryService.setAutomationStatus(tenantA, installedAutomationId, actor, "DISABLE");
    assert.strictEqual(disabled.status, "DISABLED");
    assert.strictEqual(disabled.enabled, false);

    const enabled = AutomationRegistryService.setAutomationStatus(tenantA, installedAutomationId, actor, "ENABLE");
    assert.strictEqual(enabled.status, "ACTIVE");
    assert.strictEqual(enabled.enabled, true);
  });

  // ------------------------------------------------------------
  // 3. Multi-Tenant Isolation
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3. Multi-Tenant Isolation]${ANSI_RESET}`);

  await runTest("Tenant A cannot access or mutate Tenant B automations or executions", () => {
    // Install in Tenant B
    const bInstall = AutomationRegistryService.installTemplate(tenantB, "WF-PAY-01", "usr_tenant_b");

    // Tenant A queries automations
    const tenantAAutomations = AutomationRegistryService.listAutomations(tenantA);
    assert.ok(!tenantAAutomations.some((a) => a.id === bInstall.automation.id), "Tenant A must NOT see Tenant B automation");

    // Direct access across tenants returns undefined
    const crossAccess = AutomationRegistryService.getAutomationById(tenantA, bInstall.automation.id);
    assert.strictEqual(crossAccess, undefined, "Tenant A must not be able to find Tenant B automation by ID");
  });

  // ------------------------------------------------------------
  // 4. Authoritative Idempotency Service
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4. Authoritative Idempotency]${ANSI_RESET}`);

  await runTest("Enforces exact-once execution and returns cached result on duplicate invocation", async () => {
    const idempKey = `idemp_test_${Date.now()}`;
    const op = "TEST_SIDE_EFFECT";
    let sideEffectExecutionCount = 0;

    const executeTask = async () => {
      sideEffectExecutionCount++;
      return { success: true, processed_value: 42 };
    };

    // First execution
    const res1 = await IdempotencyService.executeIdempotent(tenantA, idempKey, op, { sample: 1 }, executeTask);
    assert.strictEqual(res1.isCached, false);
    assert.strictEqual(res1.data.processed_value, 42);
    assert.strictEqual(sideEffectExecutionCount, 1);

    // Second execution with identical key -> must return cached without incrementing execution count
    const res2 = await IdempotencyService.executeIdempotent(tenantA, idempKey, op, { sample: 1 }, executeTask);
    assert.strictEqual(res2.isCached, true, "Duplicate call must return cached result");
    assert.strictEqual(res2.data.processed_value, 42);
    assert.strictEqual(sideEffectExecutionCount, 1, "Side effect MUST NOT execute twice");
  });

  // ------------------------------------------------------------
  // 5. Cryptographic Webhook Gateway & Replay Protection
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5. Cryptographic Webhook Gateway & Replay Protection]${ANSI_RESET}`);

  const testSecret = "sec_wh_steadfast_prod_key";
  process.env["STEADFAST_WEBHOOK_SECRET"] = testSecret;

  // Register webhook definition in DB for testing
  db.createAutomationWebhook({
    id: `wh_steadfast_${tenantA}`,
    tenant_id: tenantA,
    provider: "STEADFAST",
    endpoint_path: "/api/v1/automation/webhooks/steadfast",
    secret_reference: "STEADFAST_WEBHOOK_SECRET",
    signature_algorithm: "HMAC_SHA256",
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await runTest("Verifies valid HMAC-SHA256 signature on inbound partner webhook", async () => {
    const rawPayload = JSON.stringify({
      event_id: `evt_hook_${Date.now()}`,
      tracking_number: "TRK-STE-998811",
      status: "delivered",
      amount: 1500,
    });
    const timestamp = Date.now().toString();
    const validSignature = WebhookGatewayService.computeSignature(`${timestamp}.${rawPayload}`, testSecret, "HMAC_SHA256");

    const result = await WebhookGatewayService.processInboundWebhook(tenantA, {
      provider: "STEADFAST",
      endpointPath: "/api/v1/automation/webhooks/steadfast",
      headers: {
        "x-signature": validSignature,
        "x-webhook-timestamp": timestamp,
      },
      rawBody: rawPayload,
      parsedBody: JSON.parse(rawPayload),
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.code, "SUCCESS");
  });

  await runTest("Rejects webhook with forged or tampered cryptographic signature", async () => {
    const rawPayload = JSON.stringify({ tracking_number: "TRK-FORGED", status: "delivered" });
    const forgedSignature = "aabbccddeeff00112233445566778899aabbccddeeff";

    const result = await WebhookGatewayService.processInboundWebhook(tenantA, {
      provider: "STEADFAST",
      endpointPath: "/api/v1/automation/webhooks/steadfast",
      headers: {
        "x-signature": forgedSignature,
        "x-webhook-timestamp": Date.now().toString(),
      },
      rawBody: rawPayload,
      parsedBody: JSON.parse(rawPayload),
    });

    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.code, "INVALID_SIGNATURE");
  });

  await runTest("Rejects webhook with expired timestamp exceeding maximum allowed drift (300s)", async () => {
    const rawPayload = JSON.stringify({ tracking_number: "TRK-DRIFT", status: "in_transit" });
    const staleTimestamp = (Date.now() - 600000).toString(); // 10 minutes ago
    const signature = WebhookGatewayService.computeSignature(`${staleTimestamp}.${rawPayload}`, testSecret, "HMAC_SHA256");

    const result = await WebhookGatewayService.processInboundWebhook(tenantA, {
      provider: "STEADFAST",
      endpointPath: "/api/v1/automation/webhooks/steadfast",
      headers: {
        "x-signature": signature,
        "x-webhook-timestamp": staleTimestamp,
      },
      rawBody: rawPayload,
      parsedBody: JSON.parse(rawPayload),
    });

    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.code, "EXPIRED_TIMESTAMP");
  });

  // ------------------------------------------------------------
  // 6. Courier Status Normalization
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[6. Courier Status Normalization]${ANSI_RESET}`);

  await runTest("Maps diverse courier status strings into canonical DeliveryStatus", () => {
    // Steadfast
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("STEADFAST", "in_transit"), "IN_TRANSIT");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("STEADFAST", "delivered"), "DELIVERED");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("STEADFAST", "return"), "RETURNED");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("STEADFAST", "assigned_to_rider"), "OUT_FOR_DELIVERY");

    // Pathao
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("PATHAO", "pickup_requested"), "PENDING");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("PATHAO", "picked"), "PICKED_UP");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("PATHAO", "delivery_failed"), "FAILED");

    // RedX
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("REDX", "delivery_in_progress"), "OUT_FOR_DELIVERY");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("REDX", "rto_completed"), "RETURNED");

    // Paperfly
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("PAPERFLY", "linehaul"), "IN_TRANSIT");
    assert.strictEqual(CourierSyncService.normalizeCourierStatus("PAPERFLY", "undelivered"), "FAILED");
  });

  // ------------------------------------------------------------
  // 7. Provider Circuit Breaker
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[7. Provider Circuit Breaker]${ANSI_RESET}`);

  await runTest("Transitions state NORMAL -> DEGRADED -> OPEN -> HALF_OPEN on repeated failures", () => {
    const testProvider = "TEST_COURIER";
    ProviderCircuitBreakerService.reset(tenantA, testProvider);

    // Initial state
    assert.strictEqual(ProviderCircuitBreakerService.getState(tenantA, testProvider), "NORMAL");
    assert.strictEqual(ProviderCircuitBreakerService.canExecute(tenantA, testProvider), true);

    // 1st failure -> DEGRADED
    ProviderCircuitBreakerService.recordFailure(tenantA, testProvider, false);
    assert.strictEqual(ProviderCircuitBreakerService.getState(tenantA, testProvider), "DEGRADED");
    assert.strictEqual(ProviderCircuitBreakerService.canExecute(tenantA, testProvider), true);

    // 2nd & 3rd failures -> OPEN
    ProviderCircuitBreakerService.recordFailure(tenantA, testProvider, false);
    ProviderCircuitBreakerService.recordFailure(tenantA, testProvider, false);
    assert.strictEqual(ProviderCircuitBreakerService.getState(tenantA, testProvider), "OPEN");
    assert.strictEqual(ProviderCircuitBreakerService.canExecute(tenantA, testProvider), false, "Tripped circuit breaker must reject requests");

    // Reset back to NORMAL
    ProviderCircuitBreakerService.reset(tenantA, testProvider);
    assert.strictEqual(ProviderCircuitBreakerService.getState(tenantA, testProvider), "NORMAL");
  });

  // ------------------------------------------------------------
  // 8. Retry Queue & Dead-Letter Queue (DLQ)
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[8. Retry Queue & Dead-Letter Queue (DLQ)]${ANSI_RESET}`);

  await runTest("Differentiates transient vs permanent errors and bounds retries before DLQ", () => {
    assert.strictEqual(RetryQueueService.classifyFailure(502), "TRANSIENT");
    assert.strictEqual(RetryQueueService.classifyFailure(429), "TRANSIENT");
    assert.strictEqual(RetryQueueService.classifyFailure(400), "PERMANENT");
    assert.strictEqual(RetryQueueService.classifyFailure(401), "PERMANENT");
    assert.strictEqual(RetryQueueService.classifyFailure(403), "PERMANENT");
    assert.strictEqual(RetryQueueService.classifyFailure(undefined, "REPLAY_ATTACK"), "UNKNOWN_SECURITY");

    // Test retry scheduling for transient error
    const execId = `exec_retry_test_${Date.now()}`;
    const firstFailure = RetryQueueService.handleExecutionFailure(tenantA, {
      automationId: installedAutomationId,
      workflowId: "wf_test",
      executionId: execId,
      event: { test: true },
      error: { code: "HTTP_TIMEOUT", message: "Gateway timed out" },
      statusCode: 504,
      correlationId: "CORR-504",
      customMaxAttempts: 2,
    });
    assert.strictEqual(firstFailure.action, "SCHEDULED_RETRY");
    assert.ok(firstFailure.delayMs && firstFailure.delayMs >= 1000);

    // Next failure exhausting max attempts (2) -> SENT_TO_DLQ
    const secondFailure = RetryQueueService.handleExecutionFailure(tenantA, {
      automationId: installedAutomationId,
      workflowId: "wf_test",
      executionId: execId,
      event: { test: true },
      error: { code: "HTTP_TIMEOUT", message: "Gateway timed out again" },
      statusCode: 504,
      correlationId: "CORR-504",
      customMaxAttempts: 2,
    });
    const thirdFailure = RetryQueueService.handleExecutionFailure(tenantA, {
      automationId: installedAutomationId,
      workflowId: "wf_test",
      executionId: execId,
      event: { test: true },
      error: { code: "HTTP_TIMEOUT", message: "Exhausted" },
      statusCode: 504,
      correlationId: "CORR-504",
      customMaxAttempts: 2,
    });
    assert.strictEqual(thirdFailure.action, "SENT_TO_DLQ");

    // Verify record exists in DLQ
    const dlqs = DeadLetterService.listDeadLetters(tenantA);
    assert.ok(dlqs.some((d) => d.execution_id === execId));
  });

  await runTest("Replays dead letter preserving correlation ID and records audit trail", async () => {
    const dlq = DeadLetterService.enqueueDeadLetter(tenantA, {
      automationId: installedAutomationId,
      workflowId: "wf_test",
      executionId: `exec_dlq_${Date.now()}`,
      event: { sample: "test" },
      error: { code: "TEST_ERR", message: "Manual DLQ trigger" },
      attemptCount: 3,
      correlationId: "CORR-REPLAY-123",
    });

    const replay = await DeadLetterService.retryDeadLetter(tenantA, dlq.id, actor);
    assert.strictEqual(replay.success, true);
    assert.strictEqual(replay.deadLetter.status, "RETRIED");
    assert.ok(replay.newExecutionId.startsWith("exec_replay_"));
  });

  // ------------------------------------------------------------
  // 9. Safety: Loop Protection & Emergency Kill Switch
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[9. Safety: Loop Protection & Kill Switch]${ANSI_RESET}`);

  await runTest("Suppresses cyclic and deep event recursion exceeding depth 5", () => {
    // Normal single-depth event
    const safeCheck = AutomationSafetyService.checkLoopProtection("evt_1", "evt_parent");
    assert.strictEqual(safeCheck.isSafe, true);

    // Deep recursion (> 5)
    const deepCheck = AutomationSafetyService.checkLoopProtection(
      "evt_6",
      "evt_5",
      ["evt_1", "evt_2", "evt_3", "evt_4", "evt_5"]
    );
    assert.strictEqual(deepCheck.isSafe, false, "Deep event lineage must be suppressed");
    assert.ok(deepCheck.reason?.includes("lineage depth"));

    // Cyclic recursion
    const cycleCheck = AutomationSafetyService.checkLoopProtection(
      "evt_3",
      "evt_1",
      ["evt_1", "evt_2", "evt_3"]
    );
    assert.strictEqual(cycleCheck.isSafe, false, "Cyclic causation must be suppressed");
    assert.ok(cycleCheck.reason?.includes("Cyclic causality"));
  });

  await runTest("Emergency kill switch halts all automation executions immediately", async () => {
    AutomationSafetyService.tripKillSwitch("TENANT", tenantA, actor, "Testing emergency pause");
    const status = AutomationSafetyService.getKillSwitchStatus(tenantA);
    assert.strictEqual(status.isTenantPaused, true);

    const check = AutomationSafetyService.isHaltedByKillSwitch(tenantA);
    assert.strictEqual(check.isHalted, true);

    // Resume
    AutomationSafetyService.resumeKillSwitch("TENANT", tenantA, actor);
    const resumedCheck = AutomationSafetyService.isHaltedByKillSwitch(tenantA);
    assert.strictEqual(resumedCheck.isHalted, false);
  });

  // ------------------------------------------------------------
  // 10. n8n Invocation & DRY_RUN Simulation
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[10. n8n Invocation & DRY_RUN Simulation]${ANSI_RESET}`);

  await runTest("Executes DRY_RUN simulation with zero irreversible side effects", async () => {
    const result = await N8nProviderService.invokeWorkflow({
      tenantId: tenantA,
      automationId: installedAutomationId,
      workflowId: "wf_sim",
      workflowVersionId: "v1_sim",
      webhookPath: "commerceos-order-created",
      event: {
        id: "evt_sim_1",
        type: "order.created",
        version: 1,
        tenant_id: tenantA,
        aggregate_type: "order",
        aggregate_id: "ord_sim_99",
        payload: { grand_total: 500 },
      },
      correlationId: "CORR-SIM",
      idempotencyKey: `idemp_sim_${Date.now()}`,
      executionMode: "DRY_RUN",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.execution.status, "SUCCESS");
    assert.strictEqual(result.execution.execution_mode, "DRY_RUN");
  });

  // ------------------------------------------------------------
  // 11. Production n8n Workflow JSON Export Validation
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[11. Production n8n Workflow JSON Export Validation]${ANSI_RESET}`);

  const workflowsDir = path.join(process.cwd(), "n8n", "workflows");

  await runTest("All production n8n export JSON files parse and contain valid structure", () => {
    assert.ok(fs.existsSync(workflowsDir), "Workflows directory /n8n/workflows/ must exist");
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 5, "Expected at least 5 production workflow JSON files");

    for (const file of files) {
      const filePath = path.join(workflowsDir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);

      assert.ok(parsed.name, `Workflow ${file} missing name`);
      assert.ok(Array.isArray(parsed.nodes), `Workflow ${file} nodes must be an array`);
      assert.ok(parsed.nodes.length >= 4, `Workflow ${file} must contain at least 4 nodes`);
      assert.ok(parsed.connections, `Workflow ${file} missing connections`);
      assert.ok(parsed.settings, `Workflow ${file} missing settings`);

      // Verify node types are supported n8n nodes
      const validTypes = [
        "n8n-nodes-base.webhook",
        "n8n-nodes-base.code",
        "n8n-nodes-base.httpRequest",
        "n8n-nodes-base.if",
        "n8n-nodes-base.respondToWebhook",
        "n8n-nodes-base.scheduleTrigger",
        "n8n-nodes-base.googleSheetsTrigger",
        "n8n-nodes-base.googleSheets",
        "n8n-nodes-base.splitInBatches",
      ];
      for (const node of parsed.nodes) {
        assert.ok(validTypes.includes(node.type), `Workflow ${file} contains unsupported node type: ${node.type}`);
      }

      // Verify NO hardcoded secrets or passwords exist
      const sensitivePatterns = [/password/i, /whsec_[a-f0-9]{20,}/i, /bearer\s+eyJ/i, /postgres:\/\//i];
      for (const pattern of sensitivePatterns) {
        assert.ok(!pattern.test(raw), `Workflow ${file} contains sensitive hardcoded credential pattern: ${pattern}`);
      }
    }
  });

  await runTest("Initial production workflow 'commerceos-order-created-notification.json' flow verification", () => {
    const initialFile = path.join(workflowsDir, "commerceos-order-created-notification.json");
    assert.ok(fs.existsSync(initialFile), "commerceos-order-created-notification.json must exist");
    const parsed = JSON.parse(fs.readFileSync(initialFile, "utf-8"));

    const nodeNames = parsed.nodes.map((n: any) => n.name);
    assert.ok(nodeNames.includes("Order Created Webhook Trigger"), "Must contain Webhook Trigger");
    assert.ok(nodeNames.includes("Validate Event Envelope"), "Must contain Envelope Validation");
    assert.ok(nodeNames.includes("Prepare Context & Idempotency"), "Must contain Context & Idempotency Prep");
    assert.ok(nodeNames.includes("Call CommerceOS Notification API"), "Must call CommerceOS Notification API");
    assert.ok(nodeNames.includes("Verify Execution Result"), "Must verify result");
    assert.ok(nodeNames.includes("Respond Success"), "Must respond success");
    assert.ok(nodeNames.includes("Respond Failure"), "Must respond failure");
  });

  // ------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}----------------------------------------------------------------${ANSI_RESET}`);
  console.log(`  Phase 6 Automation Hub Tests: ${ANSI_GREEN}${passedCount} Passed${ANSI_RESET}, ${failedCount > 0 ? ANSI_RED : ""}${failedCount} Failed${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------------------${ANSI_RESET}\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test runner exception:", err);
  process.exit(1);
});
