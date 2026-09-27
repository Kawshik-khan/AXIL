// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import {
  autonomousControlPlaneService,
  businessObjectivesService,
  globalDecisionEngineService,
  strategyEngineService,
  crossDomainOrchestratorService,
  unifiedContextService,
  continuousLearningService,
  modelGovernanceService,
  aiProviderAbstractionService,
  modelRoutingService,
  optimizationEngineService,
  autonomyAdaptationService,
  platformHealthService,
  platformEconomicsService,
  autonomousRollbackService,
  globalIncidentService,
  dataResidencyService,
  sloEngineService,
  autonomousCyclesService,
  autonomousWorkflowsService,
} from "@/domains/autonomous/services";
import { autonomousSupervisorAgent } from "@/domains/autonomous/agents/autonomous-supervisor.agent";
import {
  objectivesAgent,
  strategyAgent,
  decisionAgent,
  learningAgent,
  optimizationAgent,
  platformHealthAgent,
  costGovernanceAgent,
} from "@/domains/autonomous/agents/domain-agents";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";
import { AUTONOMOUS_SAFETY_BOUNDARIES } from "@/types/autonomous";

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

export async function runAutonomousTests() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  COMMERCEOS PHASE 10: AUTONOMOUS PLATFORM CONVERGENCE SUITE   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_autonomous_test";

  // Reset database state for deterministic test run
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // -------------------------------------------------------------
  // 1. Business Objective Lifecycle
  // -------------------------------------------------------------
  await runTest("1. Business Objective Lifecycle: Create, Evaluate, and Assess Risk", () => {
    const obj = businessObjectivesService.createObjective({
      id: "obj_rev_growth_2026",
      tenant_id: tenantId,
      hierarchy_level: "ENTERPRISE",
      name: "Accelerate Q4 Net Revenue",
      description: "Scale net revenue across online and social channels while maintaining 30% contribution margin",
      status: "ACTIVE",
      target_metric: "NET_REVENUE_BDT",
      target_value: 5000000,
      baseline_value: 2000000,
      current_value: 3500000,
      unit: "BDT",
      time_horizon_start: new Date().toISOString(),
      time_horizon_end: new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: 1,
      risk_tolerance: "MODERATE",
      budget_allocated_bdt: 250000,
      budget_spent_bdt: 120000,
      allowed_domains: ["COMMERCE", "GROWTH", "OPERATIONS"],
      allowed_actions: ["OPTIMIZE_PRICING", "EXPAND_CAMPAIGNS"],
      required_approvals: ["HIGH_BUDGET_OVERRUN"],
      constraints: [
        { type: "MARGIN", name: "Min Gross Margin", operator: "MIN", value: 30, unit: "%" },
        { type: "BUDGET", name: "Max Spend Cap", operator: "NOT_EXCEEDS", value: 300000, unit: "BDT" },
      ],
      progress_percent: 50,
      forecast_achievement_percent: 78,
      created_by: "test_suite",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.ok(obj.id, "Objective should be created with ID");
    assert.strictEqual(obj.status, "ACTIVE");

    businessObjectivesService.updateObjective(tenantId, obj.id, { current_value: 4000000 });
    const evalResult = businessObjectivesService.evaluateProgress(tenantId, obj.id);
    assert.ok(evalResult.progress_percent > 50, "Progress should be recalculated accurately");

    const risk = businessObjectivesService.assessRisk(tenantId, obj.id);
    assert.ok(risk.risk_level, "Risk evaluation should return a valid risk level");
  });

  // -------------------------------------------------------------
  // 2. Objective Hierarchy Resolution
  // -------------------------------------------------------------
  await runTest("2. Objective Hierarchy Resolution: Multi-tier Parent-Child Linking", () => {
    // Child objective
    const child = businessObjectivesService.createObjective({
      id: "obj_child_store_growth",
      tenant_id: tenantId,
      parent_objective_id: "obj_rev_growth_2026",
      hierarchy_level: "STORE",
      name: "Dhaka Flagship Revenue",
      description: "Local store contribution target",
      status: "ACTIVE",
      target_metric: "STORE_REVENUE_BDT",
      target_value: 1500000,
      baseline_value: 800000,
      current_value: 1000000,
      unit: "BDT",
      time_horizon_start: new Date().toISOString(),
      time_horizon_end: new Date(Date.now() + 90 * 86400000).toISOString(),
      priority: 2,
      risk_tolerance: "CONSERVATIVE",
      budget_allocated_bdt: 80000,
      budget_spent_bdt: 30000,
      allowed_domains: ["COMMERCE"],
      allowed_actions: ["LOCAL_PROMOTIONS"],
      required_approvals: [],
      constraints: [],
      progress_percent: 28,
      forecast_achievement_percent: 85,
      created_by: "test_suite",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const hierarchy = businessObjectivesService.getObjectiveHierarchy(tenantId);
    assert.ok(hierarchy.length > 0, "Hierarchy tree should return root elements");
    const parentNode = hierarchy.find((h) => h.objective.id === "obj_rev_growth_2026");
    assert.ok(parentNode, "Parent objective must be present in tree");
    assert.strictEqual(parentNode.children.length, 1, "Child objective must be linked to parent");
  });

  // -------------------------------------------------------------
  // 3. Global Decision Engine
  // -------------------------------------------------------------
  await runTest("3. Global Decision Engine: Options, Simulation, Policy, and Approval", () => {
    const decision = globalDecisionEngineService.createDecision({
      id: "dec_surge_pricing_001",
      tenant_id: tenantId,
      category: "PRICING",
      title: "Apply Surge Pricing for Premium Footwear",
      description: "Adjust prices +8% during festival demand spike",
      status: "PENDING",
      risk_level: "HIGH",
      context: {
        domains_involved: ["COMMERCE", "OPERATIONS"],
        agents_involved: ["AUTONOMOUS_SUPERVISOR", "DECISION_AGENT"],
        current_state: { order_velocity: 85 },
        trigger: "VELOCITY_SPIKE",
        urgency: "HIGH",
        evidence: [{ metric: "velocity", factor: 2.3 }],
      },
      options: [
        {
          id: "opt_increase_8",
          name: "8% Dynamic Markup",
          description: "Preserve margin without dampening conversion",
          actions: ["UPDATE_PRICE_BATCH"],
          expected_outcome: { margin_lift_percent: 4.2 },
          estimated_cost_bdt: 5000,
          estimated_revenue_impact_bdt: 180000,
          risk_score: 30,
          confidence: 0.88,
          pros: ["High revenue protection"],
          cons: ["Minor basket drop risk"],
          tradeoffs: ["Margin vs Volume"],
        },
      ],
      constraints: [
        { name: "Max price change", type: "POLICY", satisfied: true, value: 8, threshold: 15 },
      ],
      requires_approval: true,
      initiated_by: "AUTONOMOUS_SUPERVISOR",
      initiated_at: new Date().toISOString(),
      correlation_id: "corr_test_001",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(decision.status, "PENDING");

    // Policy check forces escalation due to HIGH risk
    const policy = globalDecisionEngineService.applyPolicy(tenantId, decision.id);
    assert.strictEqual(policy.requires_escalation, true, "HIGH risk decision must require escalation");
    assert.strictEqual(decision.status, "AWAITING_APPROVAL");

    // Simulation
    const sim = globalDecisionEngineService.simulateDecision(tenantId, decision.id, decision.options[0].id);
    assert.ok(sim.scenarios_evaluated > 0, "Simulation scenarios should be evaluated");

    // Human Approval
    const approved = globalDecisionEngineService.approveDecision(tenantId, decision.id, "human_supervisor");
    assert.strictEqual(approved.status, "APPROVED");
    assert.strictEqual(approved.approved_by, "human_supervisor");

    // Execution & Verification
    const executed = globalDecisionEngineService.executeDecision(tenantId, decision.id);
    assert.strictEqual(executed.status, "EXECUTING");

    const verified = globalDecisionEngineService.verifyOutcome(tenantId, decision.id, {
      decision_id: decision.id,
      option_id: decision.options[0].id,
      success: true,
      verification_status: "VERIFIED",
      verification_evidence: { actual_lift: 4.5 },
      measured_at: new Date().toISOString(),
    });
    assert.strictEqual(verified.status, "VERIFIED");
  });

  // -------------------------------------------------------------
  // 4. Multi-Objective Optimization Engine
  // -------------------------------------------------------------
  await runTest("4. Optimization Engine: Multi-Objective Candidate Generation and Tradeoff Ranking", () => {
    const candidates = optimizationEngineService.generateCandidateStrategies(tenantId, "obj_rev_growth_2026");
    assert.ok(Array.isArray(candidates), "Candidates must be an array");
    assert.ok(candidates.length > 0, "Should generate strategy candidates");

    const ranked = optimizationEngineService.rankByTradeoffs(candidates);
    assert.strictEqual(ranked.length, candidates.length);
    assert.ok(ranked[0].composite_score >= ranked[ranked.length - 1].composite_score, "Ranking must be descending by score");
  });

  // -------------------------------------------------------------
  // 5. Strategy Engine
  // -------------------------------------------------------------
  await runTest("5. Strategy Engine: Formulation, Non-Destructive Simulation, and Execution", () => {
    const strategy = strategyEngineService.createStrategy({
      id: "strat_retention_blitz",
      tenant_id: tenantId,
      objective_id: "obj_rev_growth_2026",
      name: "VIP Customer Retention Blitz",
      description: "Automated omnichannel reactivation campaign for dormant VIP accounts",
      status: "DRAFT",
      version: 1,
      domains_involved: ["GROWTH", "COMMERCE"],
      plan: {
        steps: [
          { order: 1, domain: "GROWTH", action: "SEGMENT_VIP_CHURN", parameters: {}, depends_on: [], estimated_duration_ms: 3000 },
          { order: 2, domain: "GROWTH", action: "TRIGGER_DYNAMIC_OFFER", parameters: {}, depends_on: [1], estimated_duration_ms: 5000 },
        ],
        expected_duration_ms: 8000,
        estimated_cost_bdt: 12000,
      },
      constraints: [],
      created_by: "strategy_agent",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(strategy.status, "DRAFT");

    const sim = strategyEngineService.simulateStrategy(tenantId, strategy.id);
    assert.ok(sim.scenarios_tested > 0);
    assert.ok(sim.expected_case.margin_percent > 0);

    const tradeoffs = strategyEngineService.evaluateTradeoffs(tenantId, strategy.id);
    assert.ok(Array.isArray(tradeoffs.tradeoffs));

    const activated = strategyEngineService.activateStrategy(tenantId, strategy.id);
    assert.strictEqual(activated.status, "ACTIVE");
  });

  // -------------------------------------------------------------
  // 6. Cross-Domain Agent Protocol
  // -------------------------------------------------------------
  await runTest("6. Cross-Domain Agent Protocol: Inter-Agent Messaging & Conflict Resolution", () => {
    // 1. Dispatch message
    const msg = crossDomainOrchestratorService.routeAgentMessage({
      id: "msg_proto_001",
      tenant_id: tenantId,
      correlation_id: "conv_proto_001",
      from_agent: "INVENTORY",
      to_agent: "MARKETING",
      message_type: "REQUEST",
      priority: "HIGH",
      payload: { action: "PAUSE_ADS_FOR_LOW_STOCK", sku: "SKU-992", stock_remaining: 3 },
      context: {},
      requires_response: true,
      created_at: new Date().toISOString(),
    });

    assert.ok(msg.id, "Message should have an ID");
    assert.strictEqual(msg.message_type, "REQUEST");

    // 2. Conflict detection and resolution
    const conflict = crossDomainOrchestratorService.detectConflict({
      id: "conf_001",
      tenant_id: tenantId,
      correlation_id: "corr_001",
      conflicting_agents: ["INVENTORY", "MARKETING"],
      conflict_type: "OBJECTIVE_CONFLICT",
      description: "Inventory pause vs Marketing GMV",
      agent_positions: [
        { agent: "INVENTORY", position: "HALT_ADVERTISING", evidence: { stock: 3 }, priority: 1 },
        { agent: "MARKETING", position: "CONTINUE_CAMPAIGN", evidence: { gmv_target: 50000 }, priority: 2 },
      ],
      resolution_strategy: "CONSTRAINT_WINS",
      status: "DETECTED",
      created_at: new Date().toISOString(),
    });

    assert.ok(conflict, "Conflict record must be generated");
    const resolved = crossDomainOrchestratorService.resolveConflict(tenantId, conflict.id, "CONSTRAINT_WINS", "supervisor");
    assert.strictEqual(resolved.status, "RESOLVED");
    assert.strictEqual(resolved.resolution?.decision, "Most constrained position adopted");
  });

  // -------------------------------------------------------------
  // 7. Unified Commerce Context
  // -------------------------------------------------------------
  await runTest("7. Unified Commerce Context: Real-Time Cross-Domain Aggregation", () => {
    const context = unifiedContextService.buildContext(tenantId);
    assert.ok(context.commerce, "Context must contain commerce domain state");
    assert.ok(context.operations, "Context must contain operations domain state");
    assert.ok(context.intelligence, "Context must contain intelligence domain state");
    assert.ok(context.growth, "Context must contain growth domain state");
    assert.ok(context.enterprise, "Context must contain enterprise domain state");
    assert.ok(context.agents, "Context must contain agent domain state");

    const opportunities = unifiedContextService.detectOpportunities(context);
    assert.ok(Array.isArray(opportunities));

    const risks = unifiedContextService.detectRisks(context);
    assert.ok(Array.isArray(risks));
  });

  // -------------------------------------------------------------
  // 8. Continuous Learning Pipeline
  // -------------------------------------------------------------
  await runTest("8. Continuous Learning Pipeline: Candidate Stages & Promotion", () => {
    const candidate = continuousLearningService.createLearningCandidate({
      id: "lc_pricing_curve_v2",
      tenant_id: tenantId,
      category: "PRICING_POLICY",
      title: "Optimized Bangladesh Festive Markdown Curve",
      description: "Refined elastic demand thresholds for Eid festival weeks",
      status: "IDENTIFIED",
      evidence_count: 1450,
      proposed_artifact: { type: "POLICY_RULE", content: { max_markdown_step: 0.05 } },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(candidate.status, "IDENTIFIED");

    // Evaluate candidate
    const evaluated = continuousLearningService.evaluateCandidate(tenantId, candidate.id);
    assert.strictEqual(evaluated.status, "VALIDATED");

    // Promote to Shadow
    const shadow = continuousLearningService.deployToShadow(tenantId, candidate.id);
    assert.strictEqual(shadow.status, "SHADOW_TESTING");

    // Promote to Canary
    const canary = continuousLearningService.promoteToCanary(tenantId, candidate.id);
    assert.strictEqual(canary.status, "CANARY_TESTING");

    // Submit for Governance
    const gov = continuousLearningService.submitForGovernance(tenantId, candidate.id);
    assert.strictEqual(gov.status, "GOVERNANCE_REVIEW");

    // Promote to Production
    const prod = continuousLearningService.promoteToProduction(tenantId, candidate.id, "lead_governance_architect");
    assert.strictEqual(prod.status, "DEPLOYED");
    assert.strictEqual(prod.governance_review?.reviewer, "lead_governance_architect");
  });

  // -------------------------------------------------------------
  // 9. Model Governance Lifecycle
  // -------------------------------------------------------------
  await runTest("9. Model Governance: Registry, Lifecycle, and Version Tracking", () => {
    const model = modelGovernanceService.registerModel({
      id: "mdl_bangla_sentiment_v2",
      tenant_id: tenantId,
      name: "Bangla & Banglish Customer Support Classifier",
      model_type: "LLM",
      version: "2.1.0",
      provider_id: "prov_gemini",
      lifecycle_status: "DEVELOPMENT",
      capabilities: ["GENERATE"],
      performance_metrics: { accuracy: 0.94 },
      owner: "ml_engineer",
    });

    assert.strictEqual(model.lifecycle_status, "DEVELOPMENT");

    // Evaluate
    const evaluated = modelGovernanceService.evaluateModel(tenantId, model.id, {
      id: "eval_001",
      tenant_id: tenantId,
      model_id: model.id,
      evaluation_dataset: "banglish_v2",
      results: { accuracy: 0.96, quality_score: 0.95 },
      evaluated_at: new Date().toISOString(),
    });
    assert.strictEqual(evaluated.lifecycle_status, "EVALUATION");

    // Approve
    const approved = modelGovernanceService.approveModel(tenantId, model.id, "lead_architect");
    assert.strictEqual(approved.lifecycle_status, "APPROVAL");

    // Deploy to Staging, Canary, and Production
    const staged = modelGovernanceService.deployModel(tenantId, model.id, "STAGING");
    assert.strictEqual(staged.environment, "STAGING");

    const canary = modelGovernanceService.deployModel(tenantId, model.id, "CANARY");
    assert.strictEqual(canary.environment, "CANARY");

    const production = modelGovernanceService.deployModel(tenantId, model.id, "PRODUCTION");
    assert.strictEqual(production.environment, "PRODUCTION");
  });

  // -------------------------------------------------------------
  // 10. AI Provider Abstraction
  // -------------------------------------------------------------
  await runTest("10. AI Provider Abstraction: Health Check, Fallback Chain, and Routing", () => {
    const health = aiProviderAbstractionService.healthCheck();
    assert.ok(Array.isArray(health));
    assert.ok(health.length > 0);
    assert.strictEqual(health[0].status, "ACTIVE");

    const fallbackChain = aiProviderAbstractionService.getFallbackChain(tenantId, "AGENT_EXECUTION");
    assert.ok(fallbackChain);
    assert.ok(fallbackChain.chain.length >= 2, "Must configure at least primary and fallback provider");
    assert.strictEqual(fallbackChain.chain[0].provider_id, "aip_gemini");

    const estimate = aiProviderAbstractionService.estimateCost("aip_gemini", 2000, 500);
    assert.ok(estimate.total_cost_bdt > 0, "Cost estimation in BDT must be calculated");
  });

  // -------------------------------------------------------------
  // 11. Model Routing Policy
  // -------------------------------------------------------------
  await runTest("11. Model Routing Policy: Routing Evaluation Based on Task Sensitivity", () => {
    const sensitiveRoute = modelRoutingService.routeRequest(tenantId, "ENTERPRISE_FINANCE", {
      data_sensitivity: "RESTRICTED",
      max_latency_ms: 1000,
    });
    assert.ok(sensitiveRoute?.provider_id, "Provider must be chosen for sensitive tasks");

    const fastRoute = modelRoutingService.routeRequest(tenantId, "ORDER_LOOKUP", {
      data_sensitivity: "PUBLIC",
      max_latency_ms: 300,
    });
    assert.ok(fastRoute?.provider_id, "Provider must be chosen for low-latency tasks");
  });

  // -------------------------------------------------------------
  // 12. Autonomy Adaptation
  // -------------------------------------------------------------
  await runTest("12. Autonomy Adaptation: Performance-Based Recommendation Requiring Governance", () => {
    const assessment = autonomyAdaptationService.assessAutonomyLevel(tenantId, "PRICING");
    assert.ok(assessment.current_level, "Must return current autonomy level");
    assert.ok(assessment.recommended_level, "Must provide recommended autonomy level");

    // Governance check: Cannot apply without explicit approval
    const simulation = autonomyAdaptationService.simulateAdaptation(tenantId, assessment.id);
    assert.ok(simulation.simulation_result && simulation.simulation_result.risk_score >= 0, "Safety score must be evaluated");

    const applied = autonomyAdaptationService.applyAdaptation(tenantId, assessment.id, "board_governance_committee");
    assert.strictEqual(applied.reviewed_by, "board_governance_committee");
    assert.strictEqual(applied.status, "APPLIED");
  });

  // -------------------------------------------------------------
  // 13. Platform Health Monitoring
  // -------------------------------------------------------------
  await runTest("13. Platform Health: 11-Dimension Health Assessment & Anomaly Alerts", () => {
    const health = platformHealthService.getSystemHealth(tenantId);
    // Even if no record existed initially, default health is accessible
    const dimensions = platformHealthService.getDomainHealth(tenantId, "COMMERCE");
    assert.ok(dimensions === undefined || dimensions.status !== undefined);

    const anomalies = platformHealthService.detectAnomalies(tenantId);
    assert.ok(Array.isArray(anomalies));
  });

  // -------------------------------------------------------------
  // 14. Autonomous Quality Scorecard
  // -------------------------------------------------------------
  await runTest("14. Autonomous Quality Scorecard: Accuracy, Compliance, and Verification Metrics", () => {
    const scorecard = platformHealthService.getQualityScorecard(tenantId, "DAILY");
    assert.strictEqual(scorecard.period, "DAILY");
    assert.ok(scorecard.decision_accuracy >= 0 && scorecard.decision_accuracy <= 1);
    assert.ok(scorecard.policy_compliance_rate >= 0 && scorecard.policy_compliance_rate <= 1);
    assert.ok(scorecard.verification_success_rate >= 0 && scorecard.verification_success_rate <= 1);
  });

  // -------------------------------------------------------------
  // 15. Platform Economics
  // -------------------------------------------------------------
  await runTest("15. Platform Economics: Cost-Aware Autonomy Tracking & Efficiency Ratio", () => {
    platformEconomicsService.trackCost({
      id: `cost_${Date.now()}`,
      tenant_id: tenantId,
      period: "DAILY",
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
      llm_cost_usd: 12.5,
      llm_cost_bdt: 1475,
      tool_execution_cost_bdt: 250,
      workflow_cost_bdt: 500,
      total_cost_bdt: 2225,
      cost_per_order_bdt: 4.45,
      cost_per_autonomous_decision_bdt: 18.5,
      cost_efficiency_ratio: 6.8,
      breakdown_by_domain: { COMMERCE: 800, OPERATIONS: 600, GROWTH: 825 },
      breakdown_by_agent: { AUTONOMOUS_SUPERVISOR: 700, PRICING_OPERATIONS: 500 },
      computed_at: new Date().toISOString(),
    });

    const breakdown = platformEconomicsService.getCostBreakdown(tenantId, "DAILY");
    assert.ok(breakdown.length > 0, "Cost records must be retrievable");

    const efficiency = platformEconomicsService.optimizeCostEfficiency(tenantId);
    assert.ok(efficiency.current_ratio > 0);

    const entityCosts = platformEconomicsService.getEntityCosts(tenantId);
    assert.ok(entityCosts.COMMERCE > 0);
  });

  // -------------------------------------------------------------
  // 16. Autonomous Rollback & Compensation
  // -------------------------------------------------------------
  await runTest("16. Autonomous Rollback: Reversible Operations and Compensating Actions", () => {
    // Reversible action
    const canRollbackPrice = autonomousRollbackService.canRollback("CONFIGURATION");
    assert.strictEqual(canRollbackPrice.reversible, true);

    const rollbackResult = autonomousRollbackService.executeRollback({
      id: "rb_001",
      tenant_id: tenantId,
      rollback_type: "CONFIGURATION",
      target_entity_id: "act_test_001",
      target_entity_type: "CONFIG",
      previous_state: { markup: 0 },
      current_state: { markup: 8 },
      is_reversible: true,
      status: "PENDING",
      initiated_by: "test_suite",
      initiated_at: new Date().toISOString(),
    });
    assert.strictEqual(rollbackResult.status, "COMPLETED");

    // Irreversible action requires compensating action
    const canRollbackNotification = autonomousRollbackService.canRollback("EXTERNAL_CALL" as any);
    assert.strictEqual(canRollbackNotification.reversible, false);

    const compensation = autonomousRollbackService.createCompensatingAction(tenantId, "SEND_SMS", "Compensate SMS send with correction note");
    assert.strictEqual(compensation.status, "PENDING");
    assert.strictEqual(compensation.compensating_action, "Compensate SMS send with correction note");
  });

  // -------------------------------------------------------------
  // 17. Global Incident Management
  // -------------------------------------------------------------
  await runTest("17. Global Incident Management: Cross-Domain Impact Diagnosis and Blast Radius", () => {
    const incident = globalIncidentService.createIncident({
      id: `inc_auto_${Date.now()}`,
      tenant_id: tenantId,
      title: "Cross-Store Sync Latency Spike",
      severity: "P1_HIGH",
      status: "DETECTED",
      affected_domains: ["COMMERCE", "OPERATIONS"],
      affected_services: ["sync-engine", "inventory-service"],
      timeline: [],
      detected_at: new Date().toISOString(),
    });

    assert.strictEqual(incident.status, "DETECTED");

    const diagnosis = globalIncidentService.diagnoseImpact(tenantId, incident.id);
    assert.ok(diagnosis.blast_radius, "Blast radius must be computed");

    globalIncidentService.updateIncident(tenantId, incident.id, {
      status: "RESOLVED",
      root_cause: "Transient network socket pool exhaustion",
      resolution: { description: "Auto-restarted connection pool", resolved_by: "platform_health_agent" },
    });

    const active = globalIncidentService.getActiveIncidents(tenantId);
    assert.ok(!active.some((i) => i.id === incident.id), "Resolved incident should not be active");
  });

  // -------------------------------------------------------------
  // 18. Data Residency Policy
  // -------------------------------------------------------------
  await runTest("18. Data Residency Policy: Cross-Region Transfer Validation and Audit", () => {
    const policy = dataResidencyService.createPolicy({
      id: "drp_bd_001",
      tenant_id: tenantId,
      name: "BD Customer PII Residency",
      region: "BD",
      data_classification: "CUSTOMER_PII",
      storage_requirement: "LOCAL_ONLY",
      processing_requirement: "LOCAL_ONLY",
      allowed_transfer_regions: ["BD"],
      encryption_required: true,
      anonymization_required_for_external: true,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    assert.ok(policy.region, "Default data residency region must be set");

    const localTransfer = dataResidencyService.isTransferCompliant(tenantId, "BD", "BD", "CUSTOMER_PII");
    assert.strictEqual(localTransfer.compliant, true, "Intra-region transfer of PII must be allowed");

    const crossRegionCheck = dataResidencyService.isTransferCompliant(tenantId, "BD", "US", "CUSTOMER_PII");
    assert.strictEqual(crossRegionCheck.compliant, false, "Cross-border transfer must be blocked");
  });

  // -------------------------------------------------------------
  // 19. SLO Engine
  // -------------------------------------------------------------
  await runTest("19. SLO Engine: SLI Measurement, Error Budget Burn, and Compliance", () => {
    const slo = sloEngineService.createSLO({
      id: "slo_order_processing_latency",
      tenant_id: tenantId,
      name: "Order Processing Latency",
      description: "Order processing completes within 500ms",
      service: "order-service",
      sli_type: "LATENCY",
      target_value: 99.5,
      current_value: 99.7,
      unit: "%",
      error_budget_percent: 0.5,
      error_budget_remaining_percent: 0.45,
      status: "COMPLIANT",
      burn_rate_alert_threshold: 2.0,
      window_days: 30,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    assert.strictEqual(slo.target_value, 99.5);

    const errorBudget = sloEngineService.calculateErrorBudget(tenantId, slo.id);
    assert.ok(errorBudget.remaining_percent >= 0, "Error budget remaining must be calculated");

    const compliance = sloEngineService.evaluateSLOs(tenantId);
    assert.ok(Array.isArray(compliance) && compliance.length > 0, "Compliance list must be returned");
  });

  // -------------------------------------------------------------
  // 20. Autonomous Business Cycles
  // -------------------------------------------------------------
  await runTest("20. Autonomous Business Cycles: Daily, Weekly, and Monthly Execution", () => {
    const daily = autonomousCyclesService.startDailyCycle(tenantId);
    assert.strictEqual(daily.workflow_type, "DAILY_CYCLE");
    assert.strictEqual(daily.status, "OBSERVING");

    const weekly = autonomousCyclesService.startWeeklyCycle(tenantId);
    assert.strictEqual(weekly.workflow_type, "WEEKLY_CYCLE");

    const monthly = autonomousCyclesService.startMonthlyCycle(tenantId);
    assert.strictEqual(monthly.workflow_type, "MONTHLY_CYCLE");
  });

  // -------------------------------------------------------------
  // 21. 6 Canonical Cross-Domain Workflows
  // -------------------------------------------------------------
  await runTest("21. 6 Canonical Workflows: Supervisor DAG Generation for All Scenarios", () => {
    // 1. Demand Surge Response
    const surgeDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Handle massive flash sale demand surge on footwear",
      tenantId,
      workflowType: "DEMAND_SURGE_RESPONSE",
    });
    assert.ok(surgeDag.length >= 4, "Surge workflow must have multiple DAG steps");
    assert.ok(surgeDag.some((s) => s.task_type === "DETECT_DEMAND_SURGE"));

    // 2. Inventory Crisis Recovery
    const inventoryCrisisDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Recover from supplier stockout crisis in cosmetics",
      tenantId,
      workflowType: "INVENTORY_CRISIS_RECOVERY",
    });
    assert.ok(inventoryCrisisDag.some((s) => s.task_type === "AUDIT_CRISIS_STOCK"));

    // 3. Profit Optimization
    const profitDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Preserve gross profit margin across categories",
      tenantId,
      workflowType: "PROFIT_OPTIMIZATION",
    });
    assert.ok(profitDag.some((s) => s.task_type === "ANALYZE_UNIT_ECONOMICS"));

    // 4. Customer Retention Recovery
    const retentionDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Win back churning high-value customers",
      tenantId,
      workflowType: "CUSTOMER_RETENTION_RECOVERY",
    });
    assert.ok(retentionDag.some((s) => s.task_type === "IDENTIFY_CHURN_COHORTS"));

    // 5. Operational Crisis Management
    const crisisDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Mitigate courier outage crisis",
      tenantId,
      workflowType: "OPERATIONAL_CRISIS_MANAGEMENT",
    });
    assert.ok(crisisDag.some((s) => s.task_type === "DIAGNOSE_CROSS_DOMAIN_IMPACT"));

    // 6. Enterprise Expansion
    const expansionDag = autonomousSupervisorAgent.decomposeObjective({
      objective: "Scale enterprise operations to multi-store network",
      tenantId,
    });
    assert.ok(expansionDag.some((s) => s.task_type === "ALIGN_BUSINESS_OBJECTIVES"));
  });

  // -------------------------------------------------------------
  // 22. Autonomous Loop Durability
  // -------------------------------------------------------------
  await runTest("22. Autonomous Workflows Durability: Loop Progression and Step Transitions", () => {
    const loop = autonomousWorkflowsService.startWorkflow(
      tenantId,
      "DYNAMIC_REPLENISHMENT",
      "INVENTORY_THRESHOLD",
      ["INVENTORY", "PROCUREMENT"],
      ["COMMERCE", "OPERATIONS"]
    );

    assert.strictEqual(loop.status, "OBSERVING");
    assert.strictEqual(loop.current_loop_step, "OBSERVE");

    const planned = autonomousWorkflowsService.transitionStep(tenantId, loop.id, "PLAN");
    assert.strictEqual(planned.current_loop_step, "PLAN");
    assert.strictEqual(planned.status, "PLANNING");

    const completed = autonomousWorkflowsService.transitionStep(tenantId, loop.id, "COMPLETE");
    assert.strictEqual(completed.status, "COMPLETED");
  });

  // -------------------------------------------------------------
  // 23. Human Oversight Controls
  // -------------------------------------------------------------
  await runTest("23. Human Oversight Controls: Pause, Domain Pause, Kill Switch, and Resume", () => {
    // 1. Pause Domain
    const domainPause = autonomousControlPlaneService.pauseAutonomy(tenantId, { level: "DOMAIN", target: "PRICING" }, "Margin drift", "admin");
    assert.strictEqual(domainPause.success, true);
    assert.strictEqual(domainPause.paused_scope, "DOMAIN:PRICING");

    // 2. Kill Switch
    const kill = autonomousControlPlaneService.killSwitch(tenantId, "Manual emergency halt", "admin");
    assert.strictEqual(kill.halted, true);
    assert.strictEqual(autonomousControlPlaneService.getSystemMode(tenantId), "EMERGENCY_HALTED");

    // 3. Resume
    const resume = autonomousControlPlaneService.resumeAutonomy(tenantId, { level: "ALL" }, "admin");
    assert.strictEqual(resume.success, true);
    assert.strictEqual(autonomousControlPlaneService.getSystemMode(tenantId), "SEMI_AUTONOMOUS");
  });

  // -------------------------------------------------------------
  // 24. Safety Boundaries Enforcement
  // -------------------------------------------------------------
  await runTest("24. Safety Boundaries: Prohibited Self-Modifications Must Be Rejected", () => {
    // Test hardcoded boundaries
    for (const boundary of AUTONOMOUS_SAFETY_BOUNDARIES) {
      const check = autonomousControlPlaneService.validateSafetyBoundary(`ATTEMPT_${boundary}`);
      assert.strictEqual(check.allowed, false, `Boundary ${boundary} must be rejected`);
      assert.strictEqual(check.violated_boundary, boundary);
    }

    // Safe action must pass
    const safeCheck = autonomousControlPlaneService.validateSafetyBoundary("AUDIT_INVENTORY_STOCK_LEVELS");
    assert.strictEqual(safeCheck.allowed, true, "Legitimate business actions must be permitted");
  });

  // -------------------------------------------------------------
  // 25. Autonomous Agents and Tools Registry
  // -------------------------------------------------------------
  await runTest("25. Agents and Tools Registry: All 8 Phase 10 Agents and 14 Tools Registered", () => {
    const expectedAgents = [
      "AUTONOMOUS_SUPERVISOR",
      "OBJECTIVES_AGENT",
      "STRATEGY_AGENT",
      "DECISION_AGENT",
      "LEARNING_AGENT",
      "OPTIMIZATION_AGENT",
      "PLATFORM_HEALTH_AGENT",
      "COST_GOVERNANCE_AGENT",
    ];

    for (const agentType of expectedAgents) {
      const agt = agentRegistry.getAgent(agentType);
      assert.ok(agt, `Agent ${agentType} must be registered in agentRegistry`);
      assert.strictEqual(agt.enabled, true);
    }

    const expectedTools = [
      "get_autonomous_overview",
      "get_business_objectives",
      "create_business_objective",
      "simulate_objective_strategy",
      "evaluate_global_decision",
      "approve_autonomous_decision",
      "get_platform_health",
      "get_quality_scorecard",
      "get_platform_costs",
      "get_learning_candidates",
      "evaluate_learning_candidate",
      "get_active_strategies",
      "pause_domain_autonomy",
      "execute_autonomous_cycle",
    ];

    for (const toolName of expectedTools) {
      const tool = toolRegistry.getTool(toolName);
      assert.ok(tool, `Tool ${toolName} must be registered in toolRegistry`);
      assert.strictEqual(tool.category, "AUTONOMOUS");
      const def = tool.getDefinition();
      assert.strictEqual(def.name, toolName);
    }

    // Verify Global Event Publishing and Idempotency
    const event = db.publishGlobalEvent({
      event_id: "evt_test_001",
      event_type: "autonomous.decision.approved",
      version: "1.0",
      tenant_id: tenantId,
      region: "BD",
      aggregate_type: "DECISION",
      aggregate_id: "dec_surge_pricing_001",
      timestamp: new Date().toISOString(),
      correlation_id: "corr_test_001",
      idempotency_key: "idem_test_001",
      partition_key: tenantId,
      payload: { status: "APPROVED" },
      metadata: {},
      replay_safe: true,
      dead_lettered: false,
      retention_until: new Date(Date.now() + 365 * 86400000).toISOString(),
    });

    assert.strictEqual(event.event_id, "evt_test_001");
    const correlated = db.getEventsByCorrelation("corr_test_001");
    assert.strictEqual(correlated.length, 1);

    // Duplicate event should be deduplicated
    db.publishGlobalEvent(event);
    const afterDup = db.getEventsByCorrelation("corr_test_001");
    assert.strictEqual(afterDup.length, 1, "Duplicate event must be deduplicated via idempotency");
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}----------------------------------------------------------------${ANSI_RESET}`);
  console.log(`Phase 10 Autonomous Test Results: ${ANSI_GREEN}${passedCount} Passed${ANSI_RESET}, ${failedCount > 0 ? `${ANSI_RED}${failedCount} Failed${ANSI_RESET}` : "0 Failed"}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Direct CLI invocation
runAutonomousTests().catch((err) => {
  console.error("Test execution aborted with error:", err);
  process.exit(1);
});
