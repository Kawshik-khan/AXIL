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
import { taskExecutor } from "@/domains/ai/orchestration/engine/task-executor";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";
import { autonomyPolicyService } from "@/domains/ai/orchestration/autonomy/autonomy-policy.service";
import { approvalEngine } from "@/domains/ai/orchestration/autonomy/approval-engine";
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

    assert.strictEqual(validation.isValid, true);
    assert.ok(steps.some((s) => s.agent_type === "INVENTORY"));
  });

  await runTest("Supervisor decomposes 'delayed delivery exception' logistics pattern", async () => {
    const { steps, validation } = await taskPlanner.planObjective(
      contextA.tenant.id,
      "Review delayed Steadfast delivery exception and update customer"
    );

    assert.strictEqual(validation.isValid, true);
    assert.ok(steps.some((s) => s.agent_type === "SHIPPING"));
  });

  // ============================================================
  // GATE 2: DAG VALIDATION & CYCLE DETECTION
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 2: DAG Validation, Cycle & Depth Enforcement${ANSI_RESET}`);

  await runTest("PlanValidator detects and rejects cyclic dependencies (A -> B -> A)", () => {
    const cyclicPlan = [
      {
        id: "step_1",
        name: "Step 1",
        agent_type: "SALES",
        action: "DO_1",
        dependencies: ["step_2"],
      },
      {
        id: "step_2",
        name: "Step 2",
        agent_type: "INVENTORY",
        action: "DO_2",
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
    db.upsertAutonomyPolicy({
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
    db.upsertAutonomyPolicy({
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
    db.upsertAutonomyPolicy({
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
    // 1. Create a simulated approval request expecting order in 'PENDING' status
    const approvalReq = db.insertApprovalRequest({
      id: `appr_stale_test_${now}`,
      tenant_id: contextA.tenant.id,
      workflow_id: "wf_stale_test",
      task_id: "task_stale_test",
      requested_by_agent: "ORDER_ASSISTANT",
      action: "CANCEL_ORDER",
      risk_level: ActionRiskLevel.HIGH,
      target_entity_type: "ORDER",
      target_entity_id: sampleOrder.id,
      entity_state_snapshot: { order_status: "PENDING" }, // Snapshot taken when order was PENDING
      payload: { order_id: sampleOrder.id },
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
    assert.ok(result.reason.includes("Order status changed from PENDING to DELIVERED"));
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
      task_type: "CALCULATE_ESTIMATE",
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

  // ============================================================
  // GATE 10: DURABLE WORKFLOW ENGINE & CHECKPOINTING
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 10: Durable Workflow Engine Lifecycle & Step Checkpoints${ANSI_RESET}`);

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
    assert.ok([WorkflowStatus.RUNNING, WorkflowStatus.COMPLETED, WorkflowStatus.WAITING].includes(resumed.status));
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
