// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { OrderService } from "@/domains/orders/order.service";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";

// Orchestration Phase 5 Domains
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";
import { supervisorAgent } from "@/domains/ai/orchestration/agents/supervisor.agent";
import { verifierAgent } from "@/domains/ai/orchestration/agents/verifier.agent";
import { planValidator } from "@/domains/ai/orchestration/planning/plan-validator";
import { taskPlanner } from "@/domains/ai/orchestration/planning/task-planner";
import { workflowStateMachine } from "@/domains/ai/orchestration/engine/workflow-state-machine";
import { taskExecutor, TaskOutcomeUnknownError } from "@/domains/ai/orchestration/engine/task-executor";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { workflowBudgetService } from "@/domains/ai/orchestration/engine/workflow-budget.service";
import { autonomyPolicyService } from "@/domains/ai/orchestration/autonomy/autonomy-policy.service";
import { approvalEngine } from "@/domains/ai/orchestration/autonomy/approval-engine";
import { approvalDigest, approvalPayloadDigest, captureApprovalTargetState } from "@/domains/ai/orchestration/autonomy/approval-binding";
import { eventTriggerService } from "@/domains/ai/orchestration/triggers/event-trigger.service";
import { agentSchedulerService } from "@/domains/ai/orchestration/triggers/agent-scheduler.service";
import { workflowSimulator } from "@/domains/ai/orchestration/simulation/workflow-simulator";
import { orchestrationTelemetry } from "@/domains/ai/orchestration/telemetry/orchestration-telemetry";
import {
  WorkflowStatus,
  TaskStatus,
  ActionRiskLevel,
  AutonomyLevel,
  ApprovalStatus,
} from "@/types/orchestration";

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

export async function runOrchestrationTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 5: MULTI-AGENT ORCHESTRATION TEST SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  // Setup isolated tenant & user context
  const now = Date.now();
  const tenantA = await AuthService.registerTenantWithOwner({
    workspaceName: `Apex Retail Orchestration ${now}`,
    workspaceSlug: `apex-orch-${now}`,
    email: `director-${now}@apex.com.bd`,
    password: "Password123!",
    name: "Apex Director",
  });

  const contextA: RequestContext = {
    requestId: `req_${now}`,
    traceId: `trc_${now}`,
    user: {
      id: tenantA.user.id,
      email: tenantA.user.email,
      name: "Apex Director",
      status: "ACTIVE",
    },
    tenant: {
      id: tenantA.tenant.id,
      name: tenantA.tenant.name,
      slug: tenantA.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "bn-BD",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  // Seed sample products & inventory
  const sampleProduct = await ProductService.createProduct(contextA, {
    name: "Apex Leather Sneaker",
    sku: `APX-SNK-${now}`,
    base_price: 2500,
    compare_at_price: 3000,
    initial_stock: 20,
    variants: [
      { title: "Black / Size 42", sku: `APX-SNK-42-${now}`, price: 2500, initial_stock: 20 },
    ],
  });

  const sampleVariant = sampleProduct.variants[0];

  const sampleOrder = await OrderService.createOrder(contextA, {
    customer: {
      first_name: "Tanvir",
      last_name: "Hossain",
      phone: "+8801712345678",
      email: "tanvir@example.com",
    },
    delivery_address: {
      division: "Dhaka",
      district: "Dhaka",
      address_line_1: "Dhanmondi 27",
    },
    items: [
      {
        variant_id: sampleVariant.id,
        quantity: 1,
      },
    ],
    delivery_zone: "INSIDE_DHAKA",
    payment_method: "COD",
  });

  // ============================================================
  // GATE 1: SUPERVISOR DAG PLANNING
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 1: Supervisor DAG Planning & Decomposition${ANSI_RESET}`);

  await runTest("Supervisor decomposes 'abandoned cart' into validated multi-agent DAG", async () => {
    const { steps, rawPlanSteps, validation } = await taskPlanner.planObjective(
      contextA.tenant.id,
      "Recover abandoned carts with VIP discount and customer context"
    );

    assert.strictEqual(validation.isValid, true, "Plan must be valid DAG");
    assert.strictEqual(validation.errors.length, 0);
    assert.ok(steps.length >= 4, "Should have at least 4 coordinated steps");
    assert.strictEqual(steps[0].agent_type, "ORDER_ASSISTANT");
    assert.ok(validation.executionOrder.length >= 3, "Should have multiple parallel execution batches");
  });

  await runTest("Supervisor decomposes 'low stock' restock calculation pattern", async () => {
    const { steps, validation } = await taskPlanner.planObjective(
      contextA.tenant.id,
      "Audit low stock items and prepare reorder quantity"
    );

    assert.strictEqual(validation.isValid, true, JSON.stringify(validation.errors));
    assert.ok(steps.some((s) => s.agent_type === "INVENTORY"));
  });

  await runTest("Supervisor decomposes 'delayed delivery exception' logistics pattern", async () => {
    const { steps, validation } = await taskPlanner.planObjective(
      contextA.tenant.id,
      "Review delayed Steadfast delivery exception and update customer"
    );

    assert.strictEqual(validation.isValid, true, JSON.stringify(validation.errors));
    assert.ok(steps.some((s) => s.agent_type === "SHIPPING"));
  });

  await runTest("Unknown workflow objectives do not fall back to unrelated product search", () => {
    assert.deepStrictEqual(supervisorAgent.decomposeObjective({ objective: "perform an unsupported operation" }), []);
  });

  await runTest("Template matching is explicit, versioned, and rejects objectives spanning domains", async () => {
    const ambiguous = await taskPlanner.planObjective(contextA.tenant.id, "Review delayed delivery and refund the payment");
    assert.strictEqual(ambiguous.steps.length, 0);
    assert.match(ambiguous.clarification || "", /multiple workflow templates/i);
    const explicit = await taskPlanner.planObjective(contextA.tenant.id, "do the work", undefined, "LOW_STOCK_RESTOCK");
    assert.strictEqual(explicit.templateCode, "LOW_STOCK_RESTOCK");
    assert.strictEqual(explicit.templateVersion, 1);
    assert.strictEqual(explicit.validation.isValid, true);
    const falseWholesale = await taskPlanner.planObjective(contextA.tenant.id, "Sell product 50");
    assert.strictEqual(falseWholesale.steps.length, 0);
  });

  await runTest("Workflow command enqueue is tenant-scoped and idempotent", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id,
      name: "Queue idempotency check",
      objective: "Audit low stock items",
      createdBy: contextA.user.id,
      createdByType: "USER",
    });
    const first = await workflowEngine.enqueueAction(contextA.tenant.id, workflow.id, "START", "test:workflow:start:1");
    const replay = await workflowEngine.enqueueAction(contextA.tenant.id, workflow.id, "START", "test:workflow:start:1");
    assert.strictEqual(first.id, replay.id);
    assert.strictEqual(db.data.workflow_jobs.filter((job) => job.idempotency_key === "test:workflow:start:1").length, 1);
    assert.strictEqual(db.getWorkflowJobById("tenant_other", first.id), undefined);
    assert.strictEqual(first.fence_version, 0);
    db.updateWorkflowJob(contextA.tenant.id, first.id, { status: "COMPLETED" });
  });

  await runTest("Workflow queue selection interleaves tenants and rotates the starting tenant", () => {
    const baseTime = new Date().toISOString();
    const tenants = ["fair-a", "fair-b", "fair-c"];
    const queueJobs = ["fair-a", "fair-a", "fair-b", "fair-c"].map((tenantId, index) => ({
      id: `fair_job_${index}`,
      tenant_id: tenantId,
      workflow_id: `fair_workflow_${index}`,
      action: "START" as const,
      idempotency_key: `fair:key:${index}`,
      status: "PENDING" as const,
      attempt_count: 0,
      max_attempts: 3,
      fence_version: 0,
      created_at: baseTime,
      updated_at: baseTime,
    }));
    queueJobs.forEach((job) => db.createWorkflowJob(job));
    const batch = db.getDueWorkflowJobs(new Date().toISOString(), 3, tenants[0]);
    assert.deepStrictEqual(batch.map((job) => job.tenant_id), ["fair-b", "fair-c", "fair-a"]);
    const nextBatch = db.getDueWorkflowJobs(new Date().toISOString(), 3, batch[batch.length - 1].tenant_id);
    assert.deepStrictEqual(nextBatch.map((job) => job.tenant_id), ["fair-b", "fair-c", "fair-a"]);
  });

  // ============================================================
  // GATE 2: DAG VALIDATION & CYCLE DETECTION
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 2: DAG Validation, Cycle & Depth Enforcement${ANSI_RESET}`);

  await runTest("PlanValidator detects and rejects cyclic dependencies (A -> B -> A)", () => {
    const cyclicPlan = [
      {
        id: "step_1",
        task_type: "AUDIT_WAREHOUSE_STOCK",
        name: "Step 1",
        agent_type: "INVENTORY",
        action: "AUDIT_WAREHOUSE_STOCK",
        dependencies: ["step_2"],
      },
      {
        id: "step_2",
        task_type: "CALCULATE_SALES_VELOCITY",
        name: "Step 2",
        agent_type: "SALES",
        action: "CALCULATE_SALES_VELOCITY",
        dependencies: ["step_1"], // Cycle!
      },
    ];

    const result = planValidator.validate(cyclicPlan);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("Cycle detected")));
  });

  await runTest("PlanValidator rejects self-dependency (A -> A)", () => {
    const selfDepPlan = [
      {
        id: "step_self",
        name: "Self Dependent",
        agent_type: "SALES",
        action: "LOOP",
        dependencies: ["step_self"],
      },
    ];

    const result = planValidator.validate(selfDepPlan);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("cannot depend on itself")));
  });

  await runTest("PlanValidator rejects steps assigned to unregistered/disabled agents", () => {
    const invalidAgentPlan = [
      {
        id: "step_bad",
        name: "Bad Agent",
        agent_type: "NON_EXISTENT_PHANTOM_AGENT",
        action: "DO_SOMETHING",
        dependencies: [],
      },
    ];

    const result = planValidator.validate(invalidAgentPlan);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("unknown or unpermitted agent")));
  });

  await runTest("PlanValidator rejects unknown task types, task-agent mismatch, undeclared tools, and trusted-scope overrides", () => {
    const baseline = { id: "typed_step", name: "Check stock", task_type: "AUDIT_WAREHOUSE_STOCK", agent_type: "INVENTORY", action: "AUDIT_WAREHOUSE_STOCK", dependencies: [] as string[], required_tools: ["check_inventory"] };
    assert.strictEqual(planValidator.validate([{ ...baseline, task_type: "ARBITRARY_EXECUTION" }]).isValid, false);
    assert.strictEqual(planValidator.validate([{ ...baseline, agent_type: "SALES" }]).isValid, false);
    assert.strictEqual(planValidator.validate([{ ...baseline, required_tools: ["send_campaign"] }]).isValid, false);
    assert.strictEqual(planValidator.validate([{ ...baseline, parameters: { tenant_id: "tenant_other" } }]).isValid, false);
  });

  // ============================================================
  // GATE 3: DETERMINISTIC PHYSICAL VERIFIER AGENT
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 3: Deterministic Physical Verifier Agent${ANSI_RESET}`);

  await runTest("Verifier confirms claim backed by actual database order record", async () => {
    const verification = await verifierAgent.verify({
      tenantId: contextA.tenant.id,
      workflowId: "wf_test_1",
      taskId: "task_test_1",
      targetAssertion: "Order created successfully",
      claimedOutput: { order_id: sampleOrder.id },
    });

    assert.strictEqual(verification.status, "VERIFIED");
    assert.strictEqual(verification.method, "DOMAIN_STATE");
    assert.strictEqual(verification.evidence.status, sampleOrder.status);
  });

  await runTest("Verifier catches and flags false hallucinated order claim", async () => {
    const verification = await verifierAgent.verify({
      tenantId: contextA.tenant.id,
      workflowId: "wf_test_1",
      taskId: "task_test_2",
      targetAssertion: "Order exists",
      claimedOutput: { order_id: "ord_hallucinated_fake_9999" },
    });

    assert.strictEqual(verification.status, "FAILED");
    assert.ok(verification.failure_reason.includes("does not exist"));
  });

  await runTest("Verifier confirms exact available inventory stock against warehouse DB", async () => {
    const verification = await verifierAgent.verify({
      tenantId: contextA.tenant.id,
      workflowId: "wf_test_1",
      taskId: "task_test_3",
      targetAssertion: "Stock audit matches",
      claimedOutput: {
        variant_id: sampleVariant.id,
        available_quantity: 19, // 20 initial - 1 reserved in sampleOrder
      },
    });

    assert.strictEqual(verification.status, "VERIFIED");
  });

  await runTest("Verifier catches false/mismatched stock claims", async () => {
    const verification = await verifierAgent.verify({
      tenantId: contextA.tenant.id,
      workflowId: "wf_test_1",
      taskId: "task_test_4",
      targetAssertion: "Stock claim mismatch",
      claimedOutput: {
        variant_id: sampleVariant.id,
        available_quantity: 9999, // False hallucinated quantity
      },
    });

    assert.strictEqual(verification.status, "FAILED");
    assert.ok(verification.failure_reason.includes("does not match physical database inventory"));
  });

  // ============================================================
  // GATE 4: 5 AUTONOMY LEVELS & APPROVAL ENGINE
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 4: 5-Level Autonomy Matrix & Approval Engine${ANSI_RESET}`);

  await runTest("Level 0 (Disabled) requires approval for ALL actions including LOW risk", () => {
    db.upsertAutonomyPolicy(contextA.tenant.id, {
      id: `pol_${contextA.tenant.id}_sales`,
      tenant_id: contextA.tenant.id,
      agent_type: "SALES",
      autonomy_level: AutonomyLevel.LEVEL_0_DISABLED,
      allowed_tools: [],
      approval_required_for: [ActionRiskLevel.LOW, ActionRiskLevel.MEDIUM, ActionRiskLevel.HIGH, ActionRiskLevel.CRITICAL],
      max_actions_per_day: 100,
      max_cost_usd_per_day: 5,
      max_duration_ms: 30000,
      allowed_channels: ["ALL"],
      is_emergency_stopped: false,
      enabled: true,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const reqLow = autonomyPolicyService.requiresApproval(contextA.tenant.id, "SALES", ActionRiskLevel.LOW);
    assert.strictEqual(reqLow, true, "Level 0 must require approval for LOW risk");
  });

  await runTest("Level 1 (Copilot) requires human sign-off on every action", () => {
    db.upsertAutonomyPolicy(contextA.tenant.id, {
      id: `pol_${contextA.tenant.id}_sales`,
      tenant_id: contextA.tenant.id,
      agent_type: "SALES",
      autonomy_level: AutonomyLevel.LEVEL_1_COPILOT,
      allowed_tools: [],
      approval_required_for: [ActionRiskLevel.LOW, ActionRiskLevel.MEDIUM, ActionRiskLevel.HIGH, ActionRiskLevel.CRITICAL],
      max_actions_per_day: 100,
      max_cost_usd_per_day: 5,
      max_duration_ms: 30000,
      allowed_channels: ["ALL"],
      is_emergency_stopped: false,
      enabled: true,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(autonomyPolicyService.requiresApproval(contextA.tenant.id, "SALES", ActionRiskLevel.LOW), true);
    assert.strictEqual(autonomyPolicyService.requiresApproval(contextA.tenant.id, "SALES", ActionRiskLevel.HIGH), true);
  });

  await runTest("Level 2 (Assisted) executes LOW risk automatically; holds HIGH risk for approval", () => {
    db.upsertAutonomyPolicy(contextA.tenant.id, {
      id: `pol_${contextA.tenant.id}_sales`,
      tenant_id: contextA.tenant.id,
      agent_type: "SALES",
      autonomy_level: AutonomyLevel.LEVEL_2_ASSISTED,
      allowed_tools: [],
      approval_required_for: [ActionRiskLevel.HIGH, ActionRiskLevel.CRITICAL],
      max_actions_per_day: 100,
      max_cost_usd_per_day: 5,
      max_duration_ms: 30000,
      allowed_channels: ["ALL"],
      is_emergency_stopped: false,
      enabled: true,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(autonomyPolicyService.requiresApproval(contextA.tenant.id, "SALES", ActionRiskLevel.LOW), false);
    assert.strictEqual(autonomyPolicyService.requiresApproval(contextA.tenant.id, "SALES", ActionRiskLevel.HIGH), true);
  });

  // ============================================================
  // GATE 5: ACTION RISK CLASSIFICATION
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 5: Action Risk Classification${ANSI_RESET}`);

  await runTest("Classifies actions into appropriate risk tiers", () => {
    assert.strictEqual(autonomyPolicyService.classifyRisk("PURGE_RECORDS", "DATABASE"), ActionRiskLevel.CRITICAL);
    assert.strictEqual(autonomyPolicyService.classifyRisk("PROCESS_REFUND", "ORDER", { amount: 8000 }), ActionRiskLevel.CRITICAL);
    assert.strictEqual(autonomyPolicyService.classifyRisk("CANCEL_ORDER", "ORDER"), ActionRiskLevel.HIGH);
    assert.strictEqual(autonomyPolicyService.classifyRisk("APPLY_COUPON", "CART"), ActionRiskLevel.MEDIUM);
    assert.strictEqual(autonomyPolicyService.classifyRisk("CHECK_STOCK", "INVENTORY"), ActionRiskLevel.LOW);
  });

  // ============================================================
  // GATE 6: PRE-EXECUTION ENTITY STATE REVALIDATION
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 6: Pre-Execution Entity State Revalidation (Anti-Stale Shield)${ANSI_RESET}`);

  await runTest("ApprovalEngine detects concurrent entity mutation and rejects stale approval", async () => {
    const staleTaskId = `task_stale_test_${now}`;
    const staleTask = {
      id: staleTaskId, tenant_id: contextA.tenant.id, workflow_id: "wf_stale_test", agent_id: "agent_order",
      agent_type: "ORDER_ASSISTANT", task_type: "CANCEL_ORDER", objective: "Cancel order",
      status: TaskStatus.WAITING_APPROVAL, priority: "HIGH", risk_level: ActionRiskLevel.HIGH,
      input: { order_id: sampleOrder.id }, dependencies: [], assigned_tools: [], attempt_count: 0, max_attempts: 3,
      timeout_ms: 30_000, idempotency_key: `stale_${now}`, approval_id: `appr_stale_test_${now}`,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    db.insertTask(staleTask);
    const targetSnapshot = captureApprovalTargetState(contextA.tenant.id, "ORDER", sampleOrder.id);
    // 1. Create a simulated approval request expecting order in 'PENDING' status
    const approvalReq = db.insertApprovalRequest({
      id: `appr_stale_test_${now}`,
      tenant_id: contextA.tenant.id,
      workflow_id: "wf_stale_test",
      task_id: staleTaskId,
      requested_by_agent: "ORDER_ASSISTANT",
      action: "CANCEL_ORDER",
      risk_level: ActionRiskLevel.HIGH,
      target_entity_type: "ORDER",
      target_entity_id: sampleOrder.id,
      entity_state_snapshot: targetSnapshot, // Snapshot taken before the order is mutated below
      payload: { order_id: sampleOrder.id },
      requester_id: contextA.user.id,
      payload_digest: approvalPayloadDigest(contextA.tenant.id, staleTask),
      entity_state_digest: approvalDigest(targetSnapshot),
      policy_version: autonomyPolicyService.getPolicy(contextA.tenant.id, "ORDER_ASSISTANT").version,
      reason: "Customer requested cancellation",
      status: ApprovalStatus.PENDING,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    // 2. Concurrently mutate the physical order in DB (e.g. warehouse shipped it!)
    db.updateOrderStatus(contextA.tenant.id, sampleOrder.id, "DELIVERED");

    // 3. Human tries to approve the stale action
    const result = await approvalEngine.approveAction(contextA.tenant.id, approvalReq.id, "Operator");

    assert.strictEqual(result.success, false, "Must fail pre-execution validation");
    assert.strictEqual(result.stale, true, "Must flag stale entity");
    assert.ok(result.reason.includes(`Order status changed from ${targetSnapshot.status} to DELIVERED`), result.reason);
    assert.strictEqual(result.approval.status, ApprovalStatus.REJECTED);
  });

  await runTest("Approval rejects self-approval and payload tampering", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id, name: "Approval Binding Test",
      objective: "Audit low stock items and prepare reorder quantity", createdBy: contextA.user.id, createdByType: "USER",
    });
    const task = db.getTasks(contextA.tenant.id, workflow.id)[0];
    db.updateWorkflow(contextA.tenant.id, workflow.id, { status: WorkflowStatus.WAITING });
    db.updateTask(contextA.tenant.id, task.id, {
      status: TaskStatus.READY, risk_level: ActionRiskLevel.HIGH,
      input: { order_id: sampleOrder.id }, task_type: "CANCEL_ORDER",
    });
    const requested = await taskExecutor.executeTask(db.getTaskById(contextA.tenant.id, task.id));
    assert.strictEqual(requested.status, TaskStatus.WAITING_APPROVAL);
    const approval = db.getApprovalRequestById(contextA.tenant.id, requested.task.approval_id);
    const selfApproval = await approvalEngine.approveAction(contextA.tenant.id, approval.id, contextA.user.id);
    assert.strictEqual(selfApproval.success, false);
    assert.match(selfApproval.reason, /requester cannot approve/i);

    db.updateTask(contextA.tenant.id, task.id, { input: { order_id: sampleOrder.id, refund_amount: 500 } });
    const tampered = await approvalEngine.approveAction(contextA.tenant.id, approval.id, "another-operator");
    assert.strictEqual(tampered.success, false);
    assert.strictEqual(tampered.stale, true);
    assert.match(tampered.reason, /payload no longer matches/i);
    assert.strictEqual(db.getTaskById(contextA.tenant.id, task.id).status, TaskStatus.FAILED);
  });

  await runTest("Executor refuses an approval-gated action without an approved bound request", async () => {
    const task = {
      id: `task_approval_bypass_${now}`, tenant_id: contextA.tenant.id, workflow_id: `wf_approval_bypass_${now}`,
      agent_id: "agent_order", agent_type: "ORDER_ASSISTANT", task_type: "CANCEL_ORDER",
      objective: "Approval gate bypass regression", status: TaskStatus.READY, priority: "HIGH",
      risk_level: ActionRiskLevel.HIGH, input: { order_id: sampleOrder.id }, dependencies: [], assigned_tools: [],
      attempt_count: 0, max_attempts: 2, timeout_ms: 10_000, idempotency_key: `approval_bypass_${now}`,
      approval_id: "missing-or-unapproved-approval", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    db.insertTask(task);
    const result = await taskExecutor.executeTask(task);
    assert.strictEqual(result.status, TaskStatus.FAILED);
    assert.strictEqual(result.task.failure_class, "POLICY_DENIED");
    assert.match(result.error, /approved request/i);
  });

  await runTest("Approval is invalidated when the autonomy policy revision changes", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id, name: "Approval Policy Version Test",
      objective: "Audit low stock items and prepare reorder quantity", createdBy: contextA.user.id, createdByType: "USER",
    });
    const task = db.getTasks(contextA.tenant.id, workflow.id)[0];
    db.updateTask(contextA.tenant.id, task.id, {
      status: TaskStatus.READY, risk_level: ActionRiskLevel.HIGH,
      input: { order_id: sampleOrder.id }, task_type: "CANCEL_ORDER",
    });
    const requested = await taskExecutor.executeTask(db.getTaskById(contextA.tenant.id, task.id));
    const approval = db.getApprovalRequestById(contextA.tenant.id, requested.task.approval_id);
    const policy = autonomyPolicyService.getPolicy(contextA.tenant.id, task.agent_type);
    db.upsertAutonomyPolicy(contextA.tenant.id, { ...policy, version: policy.version + 1, updated_at: new Date().toISOString() });
    const result = await approvalEngine.approveAction(contextA.tenant.id, approval.id, "independent-operator");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.stale, true);
    assert.match(result.reason, /policy changed/i);
    assert.strictEqual(result.approval.status, ApprovalStatus.REJECTED);
  });

  // ============================================================
  // GATE 7: EMERGENCY KILL SWITCH
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 7: Emergency Kill Switch${ANSI_RESET}`);

  await runTest("Triggering Emergency Stop immediately blocks agent execution", async () => {
    autonomyPolicyService.triggerEmergencyStop(contextA.tenant.id, "SALES", "Security alert");
    const policy = autonomyPolicyService.getPolicy(contextA.tenant.id, "SALES");
    assert.strictEqual(policy.is_emergency_stopped, true);

    // Any attempt to execute task with SALES agent should be aborted
    const dummyTask = {
      id: `task_halt_${now}`,
      tenant_id: contextA.tenant.id,
      workflow_id: "wf_halt",
      agent_id: "agent_sales",
      agent_type: "SALES",
      task_type: "GENERATE_OFFER",
      objective: "Halt test",
      status: TaskStatus.PENDING,
      priority: "MEDIUM",
      risk_level: ActionRiskLevel.LOW,
      input: {},
      dependencies: [],
      assigned_tools: [],
      attempt_count: 0,
      max_attempts: 3,
      timeout_ms: 10000,
      idempotency_key: `idemp_${now}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.insertTask(dummyTask);

    const execResult = await taskExecutor.executeTask(dummyTask);
    assert.strictEqual(execResult.status, TaskStatus.FAILED);
    assert.ok(execResult.error.includes("Emergency Kill Switch active"));

    // Clear stop
    autonomyPolicyService.clearEmergencyStop(contextA.tenant.id, "SALES");
    const clearedPolicy = autonomyPolicyService.getPolicy(contextA.tenant.id, "SALES");
    assert.strictEqual(clearedPolicy.is_emergency_stopped, false);
  });

  // ============================================================
  // GATE 8: INTER-AGENT DELEGATION CONTAINMENT
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 8: Inter-Agent Delegation Containment${ANSI_RESET}`);

  await runTest("AgentRegistry prevents delegation to undeclared capabilities", () => {
    const result = agentRegistry.validateDelegation(
      "SALES",
      "INVENTORY",
      "PHYSICAL_SHIPPING_LABEL_PRINTING" // Inventory does not declare this!
    );
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("does not possess declared capability"));
  });

  await runTest("AgentRegistry prevents cyclic self-delegation loops", () => {
    const result = agentRegistry.validateDelegation(
      "SALES",
      "SALES", // Self-delegation!
      "PRODUCT_RECOMMENDATION"
    );
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes("Self-delegation loop detected"));
  });

  // ============================================================
  // GATE 9: IDEMPOTENT ACTION RECEIPTS
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 9: Idempotent Action Receipts & Ledger${ANSI_RESET}`);

  await runTest("Task execution creates immutable ActionReceipt with idempotency key", async () => {
    const receiptKey = `idemp_receipt_test_${now}`;
    const testTask = {
      id: `task_rcpt_${now}`,
      tenant_id: contextA.tenant.id,
      workflow_id: "wf_rcpt",
      agent_id: "agent_shipping",
      agent_type: "SHIPPING",
      task_type: "CALCULATE_SHIPPING_ESTIMATE",
      objective: "Calculate shipping",
      status: TaskStatus.READY,
      priority: "MEDIUM",
      risk_level: ActionRiskLevel.LOW,
      input: { city: "Dhaka", weight_kg: 1 },
      dependencies: [],
      assigned_tools: [],
      attempt_count: 0,
      max_attempts: 3,
      timeout_ms: 10000,
      idempotency_key: receiptKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.insertTask(testTask);

    const execResult = await taskExecutor.executeTask(testTask);
    assert.strictEqual(execResult.status, TaskStatus.COMPLETED);
    assert.ok(execResult.receipt, "Must return an ActionReceipt");

    // Verify receipt stored in DB
    const storedReceipt = db.getActionReceiptByIdempotencyKey(contextA.tenant.id, receiptKey);
    assert.ok(storedReceipt);
    assert.strictEqual(storedReceipt.idempotency_key, receiptKey);
    assert.strictEqual(storedReceipt.status, "SUCCESS");
  });

  await runTest("Transient task failures use delayed bounded retry without changing the idempotency key", async () => {
    const retryKey = `retry_idemp_${now}`;
    const task = {
      id: `task_retry_${now}`, tenant_id: contextA.tenant.id, workflow_id: `wf_retry_${now}`,
      agent_id: "agent_shipping", agent_type: "SHIPPING", task_type: "CALCULATE_SHIPPING_ESTIMATE",
      objective: "Retry taxonomy check", status: TaskStatus.READY, priority: "MEDIUM", risk_level: ActionRiskLevel.LOW,
      input: { city: "Dhaka", weight_kg: 1 }, dependencies: [], assigned_tools: [], attempt_count: 0,
      max_attempts: 3, timeout_ms: 10_000, idempotency_key: retryKey,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    db.insertTask(task);
    const executor = taskExecutor as unknown as { dispatchAgentAction: (input: typeof task) => Promise<Record<string, unknown>> };
    const original = executor.dispatchAgentAction;
    executor.dispatchAgentAction = async () => { throw new Error("temporary transport failure"); };
    try {
      const result = await taskExecutor.executeTask(task);
      assert.strictEqual(result.status, TaskStatus.RETRY_WAIT);
      assert.ok(result.task.next_attempt_at && Date.parse(result.task.next_attempt_at) > Date.now());
      assert.strictEqual(result.task.failure_class, "RETRYABLE");
      assert.strictEqual(result.task.idempotency_key, retryKey);
      const immediateReplay = await taskExecutor.executeTask(result.task);
      assert.strictEqual(immediateReplay.status, TaskStatus.RETRY_WAIT);
      assert.strictEqual(db.getActionReceiptByIdempotencyKey(contextA.tenant.id, retryKey), undefined);
    } finally { executor.dispatchAgentAction = original; }
  });

  await runTest("Uncertain external outcome stops automatic retries pending reconciliation", async () => {
    const key = `unknown_idemp_${now}`;
    const task = {
      id: `task_unknown_${now}`, tenant_id: contextA.tenant.id, workflow_id: `wf_unknown_${now}`,
      agent_id: "agent_shipping", agent_type: "SHIPPING", task_type: "SEND_SHIPMENT_UPDATE",
      objective: "Uncertain external outcome check", status: TaskStatus.READY, priority: "MEDIUM", risk_level: ActionRiskLevel.LOW,
      input: { target_id: "shipment_1" }, dependencies: [], assigned_tools: [], attempt_count: 0,
      max_attempts: 3, timeout_ms: 10_000, idempotency_key: key,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    db.insertTask(task);
    const executor = taskExecutor as unknown as { dispatchAgentAction: (input: typeof task) => Promise<Record<string, unknown>> };
    const original = executor.dispatchAgentAction;
    executor.dispatchAgentAction = async () => { throw new TaskOutcomeUnknownError("provider timed out after request transmission"); };
    try {
      const result = await taskExecutor.executeTask(task);
      assert.strictEqual(result.status, TaskStatus.OUTCOME_UNKNOWN);
      assert.strictEqual(result.task.failure_class, "OUTCOME_UNKNOWN");
      assert.strictEqual(db.getActionReceiptByIdempotencyKey(contextA.tenant.id, key), undefined);
      const replay = await taskExecutor.executeTask(result.task);
      assert.strictEqual(replay.status, TaskStatus.OUTCOME_UNKNOWN);
      assert.strictEqual(db.getTaskById(contextA.tenant.id, task.id).attempt_count, 1);
    } finally { executor.dispatchAgentAction = original; }
  });

  await runTest("Operator reconciliation records evidence and prevents replay of an applied action", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id, name: "Outcome Reconciliation Test",
      objective: "Audit low stock items and prepare reorder quantity", createdBy: contextA.user.id, createdByType: "USER",
    });
    const tasks = db.getTasks(contextA.tenant.id, workflow.id);
    const target = tasks[0];
    db.updateWorkflow(contextA.tenant.id, workflow.id, { status: WorkflowStatus.WAITING });
    db.updateTask(contextA.tenant.id, target.id, {
      status: TaskStatus.OUTCOME_UNKNOWN, failure_class: "OUTCOME_UNKNOWN",
      idempotency_key: `reconcile_${now}`, error: "provider response lost",
    });
    for (const other of tasks.slice(1)) db.updateTask(contextA.tenant.id, other.id, { status: TaskStatus.COMPLETED });
    const result = await workflowEngine.reconcileTaskOutcome(
      contextA.tenant.id, target.id, "APPLIED", contextA.user.id, "provider:receipt-verified-123", { confirmed: true },
    );
    const reconciled = db.getTaskById(contextA.tenant.id, target.id);
    const receipt = db.getActionReceiptByIdempotencyKey(contextA.tenant.id, reconciled.idempotency_key);
    assert.strictEqual(reconciled.status, TaskStatus.COMPLETED);
    assert.strictEqual(receipt.provider_reference, "provider:receipt-verified-123");
    assert.strictEqual(reconciled.metadata.reconciliations[0].actor_id, contextA.user.id);
    assert.strictEqual(result.status, WorkflowStatus.COMPLETED);
  });

  await runTest("Task deadlines expire before execution and prevent action receipts", async () => {
    const expiredTask = {
      id: `task_expired_${now}`,
      tenant_id: contextA.tenant.id,
      workflow_id: `wf_expired_${now}`,
      agent_id: "agent_shipping",
      agent_type: "SHIPPING",
      task_type: "CALCULATE_SHIPPING_ESTIMATE",
      objective: "Deadline enforcement test",
      status: TaskStatus.PENDING,
      priority: "MEDIUM",
      risk_level: ActionRiskLevel.LOW,
      input: { city: "Dhaka", weight_kg: 1 },
      dependencies: [],
      assigned_tools: [],
      attempt_count: 0,
      max_attempts: 3,
      timeout_ms: 10_000,
      deadline: new Date(Date.now() - 1_000).toISOString(),
      idempotency_key: `idemp_expired_${now}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.insertTask(expiredTask);
    const result = await taskExecutor.executeTask(expiredTask);
    assert.strictEqual(result.status, TaskStatus.EXPIRED);
    assert.strictEqual(db.getActionReceiptByIdempotencyKey(contextA.tenant.id, expiredTask.idempotency_key), undefined);
  });

  await runTest("Cancelled workflow cannot be completed by a later task execution", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id,
      name: "Cancellation Race Test",
      objective: "Audit low stock items and prepare reorder quantity",
      createdBy: contextA.user.id,
      createdByType: "USER",
    });
    const cancelled = await workflowEngine.cancelWorkflow(contextA.tenant.id, workflow.id, "Operator stop");
    const task = db.getTasks(contextA.tenant.id, workflow.id)[0];
    const result = await taskExecutor.executeTask(task);
    assert.strictEqual(cancelled.status, WorkflowStatus.CANCELLED);
    assert.strictEqual(result.status, TaskStatus.CANCELLED);
    assert.strictEqual(db.getTaskById(contextA.tenant.id, task.id).status, TaskStatus.CANCELLED);
  });

  // ============================================================
  // GATE 10: DURABLE WORKFLOW ENGINE & CHECKPOINTING
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 10: Durable Workflow Engine Lifecycle & Step Checkpoints${ANSI_RESET}`);

  await runTest("Concurrent task reservations enforce workflow and task token/cost/tool ceilings", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id,
      name: "Budget Reservation Test",
      objective: "Audit low stock items and prepare reorder quantity",
      createdBy: contextA.user.id,
      createdByType: "USER",
    });
    const tasks = db.getTasks(contextA.tenant.id, workflow.id);
    assert.ok(tasks.length >= 2, "fixture should include competing tasks");
    assert.strictEqual(tasks.reduce((sum, task) => sum + task.budget.max_tokens, 0), workflow.budget.max_tokens);
    assert.strictEqual(tasks.reduce((sum, task) => sum + task.budget.max_tool_calls, 0), workflow.budget.max_tool_calls);
    assert.ok(Math.abs(tasks.reduce((sum, task) => sum + task.budget.max_cost_usd, 0) - workflow.budget.max_cost_usd) < 1e-7);
    db.updateWorkflow(contextA.tenant.id, workflow.id, {
      status: WorkflowStatus.RUNNING,
      budget: { ...workflow.budget, max_tokens: 100_000, max_cost_usd: 100, max_tool_calls: 1 },
    });
    for (const task of tasks) {
      db.updateTask(contextA.tenant.id, task.id, {
        budget: { ...task.budget, max_tokens: 10_000, max_cost_usd: 10, max_tool_calls: 1 },
      });
    }
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const results = await Promise.allSettled(tasks.slice(0, 2).map((task) =>
      workflowBudgetService.reserveTask(contextA.tenant.id, workflow.id, task.id, expiresAt)
    ));
    assert.strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.strictEqual(results.filter((result) => result.status === "rejected").length, 1);
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    const winner = tasks[winnerIndex];
    const reservation = (results[winnerIndex] as PromiseFulfilledResult<{ reservationId: string }>).value;
    await workflowBudgetService.consumeTaskUsage(contextA.tenant.id, workflow.id, winner.id, reservation.reservationId, {
      tokens: 25,
      costUsd: 0.25,
      toolCalls: 1,
    });
    await assert.rejects(() => workflowBudgetService.consumeTaskUsage(
      contextA.tenant.id, workflow.id, winner.id, reservation.reservationId, { toolCalls: 1 },
    ));
    await workflowBudgetService.settleTask(contextA.tenant.id, workflow.id, winner.id, reservation.reservationId);
    const settledWorkflow = db.getWorkflowById(contextA.tenant.id, workflow.id);
    const settledTask = db.getTaskById(contextA.tenant.id, winner.id);
    assert.strictEqual(settledWorkflow.budget.used_tokens, 25);
    assert.strictEqual(settledWorkflow.budget.used_cost_usd, 0.25);
    assert.strictEqual(settledWorkflow.budget.used_tool_calls, 1);
    assert.strictEqual(settledTask.budget.used_tokens, 25);
    assert.deepStrictEqual(settledWorkflow.budget.reservations || {}, {});
    await workflowEngine.cancelWorkflow(contextA.tenant.id, workflow.id, "Budget test cleanup");
  });

  await runTest("Expired task holds settle recorded usage and fail closed after worker loss", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id,
      name: "Expired Hold Recovery Test",
      objective: "Audit low stock items and prepare reorder quantity",
      createdBy: contextA.user.id,
      createdByType: "USER",
    });
    const task = db.getTasks(contextA.tenant.id, workflow.id)[0];
    db.updateWorkflow(contextA.tenant.id, workflow.id, { status: WorkflowStatus.RUNNING });
    const reservation = await workflowBudgetService.reserveTask(
      contextA.tenant.id,
      workflow.id,
      task.id,
      new Date(Date.now() + 60_000).toISOString(),
    );
    await workflowBudgetService.consumeTaskUsage(contextA.tenant.id, workflow.id, task.id, reservation.reservationId, { toolCalls: 1 });
    const withHold = db.getWorkflowById(contextA.tenant.id, workflow.id);
    const hold = withHold.budget.reservations[task.id];
    db.updateWorkflow(contextA.tenant.id, workflow.id, {
      budget: { ...withHold.budget, reservations: { ...withHold.budget.reservations, [task.id]: { ...hold, expires_at: new Date(Date.now() - 1).toISOString() } } },
    });

    assert.strictEqual(await workflowBudgetService.reconcileExpiredReservations(contextA.tenant.id, workflow.id), 1);
    const recoveredWorkflow = db.getWorkflowById(contextA.tenant.id, workflow.id);
    const recoveredTask = db.getTaskById(contextA.tenant.id, task.id);
    assert.strictEqual(recoveredWorkflow.budget.used_tool_calls, 1);
    assert.strictEqual(recoveredTask.status, TaskStatus.EXPIRED);
    assert.deepStrictEqual(recoveredWorkflow.budget.reservations || {}, {});
    await workflowEngine.cancelWorkflow(contextA.tenant.id, workflow.id, "Expired hold test cleanup");
  });

  await runTest("Workflow creates, executes, checkpoints, pauses, and resumes", async () => {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: contextA.tenant.id,
      name: "Restock Automation Test",
      objective: "Audit low stock items and prepare reorder quantity",
      triggerType: "MANUAL",
    });

    assert.ok(workflow.id);
    assert.strictEqual(workflow.status, WorkflowStatus.QUEUED);
    assert.ok(workflow.tasks.length > 0);

    // Verify initial checkpoint exists
    const chks = db.getWorkflowCheckpoints(workflow.tenant_id, workflow.id);
    assert.ok(chks.length >= 1, "Initial plan checkpoint must be stored");

    // Pause workflow
    const paused = await workflowEngine.pauseWorkflow(workflow.tenant_id, workflow.id, "Operator hold");
    assert.strictEqual(paused.status, WorkflowStatus.PAUSED);

    // Checkpoint after pause
    const pausedChks = db.getWorkflowCheckpoints(workflow.tenant_id, workflow.id);
    assert.ok(pausedChks.some((c) => c.reason.includes("paused")));

    // Resume workflow
    const resumed = await workflowEngine.resumeWorkflow(workflow.tenant_id, workflow.id);
    assert.strictEqual(resumed.status, WorkflowStatus.FAILED);
    assert.ok(resumed.error, "Unsupported downstream plan work must fail visibly, not appear complete");
  });

  // ============================================================
  // GATE 11: EVENT-DRIVEN REACTIVE AUTOMATION & COOLDOWNS
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 11: Event-Driven Reactive Automation & Cooldown Buffers${ANSI_RESET}`);

  await runTest("EventTriggerService triggers workflow on matching domain event", async () => {
    // 1. Register trigger rule
    const rule = db.insertAgentTriggerRule({
      id: `rule_low_stock_${now}`,
      tenant_id: contextA.tenant.id,
      event_type: "inventory.low_stock",
      conditions: [{ field: "quantity", operator: "LESS_THAN", value: 5 }],
      target_workflow_template_id: "LOW_STOCK_RESTOCK",
      target_agent: "INVENTORY",
      cooldown_seconds: 60,
      max_runs_per_day: 10,
      runs_today: 0,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2. Dispatch matching event
    const triggerResult = await eventTriggerService.handleDomainEvent({
      tenant_id: contextA.tenant.id,
      type: "inventory.low_stock",
      payload: { variant_id: sampleVariant.id, quantity: 2 },
    });

    assert.strictEqual(triggerResult.triggered, true);
    assert.ok(triggerResult.workflowId);

    // 3. Dispatch duplicate event immediately -> Must be blocked by cooldown!
    const cooldownResult = await eventTriggerService.handleDomainEvent({
      tenant_id: contextA.tenant.id,
      type: "inventory.low_stock",
      payload: { variant_id: sampleVariant.id, quantity: 1 },
    });

    assert.strictEqual(cooldownResult.triggered, false, "Cooldown must block immediate re-triggering");
  });

  // ============================================================
  // GATE 12: AGENT SCHEDULER & TELEMETRY OBSERVABILITY
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 12: Scheduled Agent Execution & Telemetry Observability${ANSI_RESET}`);

  await runTest("AgentSchedulerService registers and evaluates due recurring schedules", async () => {
    const schedule = agentSchedulerService.createSchedule({
      tenantId: contextA.tenant.id,
      name: "Daily 9 AM Restock Digest",
      description: "Audit low stock items and prepare reorder quantity",
      workflowTemplateId: "LOW_STOCK_RESTOCK",
      cronExpression: "0 9 * * *",
      targetAgent: "INVENTORY",
    });

    assert.ok(schedule.id);
    assert.strictEqual(schedule.is_active, true);

    // Force schedule to be due by setting next_run_at in the past
    db.updateAgentSchedule(schedule.tenant_id, schedule.id, {
      next_run_at: new Date(Date.now() - 1000).toISOString(),
    });

    const triggered = await agentSchedulerService.evaluateDueSchedules(contextA.tenant.id);
    assert.ok(triggered.includes(schedule.id), "Due schedule must be triggered");

    // Verify next run pushed to future
    const updatedSched = db.getAgentSchedules(contextA.tenant.id).find((s) => s.id === schedule.id);
    assert.ok(new Date(updatedSched.next_run_at) > new Date());
  });

  await runTest("WorkflowSimulator projects steps, costs, and approval points before execution", async () => {
    const sim = await workflowSimulator.simulate(
      contextA.tenant.id,
      "Recover abandoned carts with discount and customer preference"
    );

    assert.ok(sim.planned_steps.length > 0);
    assert.ok(sim.estimated_tokens > 0);
    assert.ok(sim.estimated_cost_usd > 0);
    assert.ok(sim.required_agents.length > 0);
    assert.strictEqual(sim.safe_to_execute, true);
    assert.strictEqual(sim.execution_ready, false, "A structurally valid plan may still contain task types without handlers");
    assert.ok(sim.warnings.some((warning) => warning.includes("Typed execution handlers")));
  });

  await runTest("OrchestrationTelemetry aggregates accurate multi-agent metrics", () => {
    const metrics = orchestrationTelemetry.getTenantMetrics(contextA.tenant.id);
    assert.ok(metrics.total_workflows >= 1);
    assert.ok(typeof metrics.success_rate === "number");
    assert.ok(metrics.total_action_receipts >= 1);
    assert.ok(metrics.total_verifications >= 1);
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(
    `Orchestration Test Results: ${ANSI_GREEN}${passedCount} Passed${ANSI_RESET}, ${
      failedCount > 0 ? `${ANSI_RED}${failedCount} Failed${ANSI_RESET}` : `0 Failed`
    }`
  );
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute if run directly
runOrchestrationTests().catch((err) => {
  console.error("Orchestration Test Suite Fatal Error:", err);
  process.exit(1);
});
