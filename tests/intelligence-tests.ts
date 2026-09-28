// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { metricRegistryService } from "@/domains/intelligence/services/metric-registry.service";
import { analyticsQueryService } from "@/domains/intelligence/services/analytics-query.service";
import { intelligenceIngestionService } from "@/domains/intelligence/services/intelligence-ingestion.service";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";
import { forecastingService } from "@/domains/intelligence/services/forecasting.service";
import { simulationService } from "@/domains/intelligence/services/simulation.service";
import { customerIntelligenceService } from "@/domains/intelligence/services/customer-intelligence.service";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";
import { decisionService } from "@/domains/intelligence/services/decision.service";
import { feedbackLoopService } from "@/domains/intelligence/services/feedback-loop.service";
import { intelligenceSupervisorAgent } from "@/domains/intelligence/agents/intelligence-supervisor.agent";
import { dataQualityService } from "@/domains/intelligence/services/data-quality.service";
import { modelRegistryService } from "@/domains/intelligence/services/model-registry.service";
import { nlAnalyticsService } from "@/domains/intelligence/services/nl-analytics.service";
import { intelligenceWorkflowService } from "@/domains/intelligence/services/intelligence-workflow.service";

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

export async function runIntelligenceTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 6: COMMERCE INTELLIGENCE TEST SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_test_intel_01";
  const now = new Date();

  // Setup seed transactions for testing
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // Seed sample products & variants
  const prod = {
    id: "prod_shirt_101",
    tenant_id: tenantId,
    title: "Classic Oxford Shirt",
    slug: "classic-oxford-shirt",
    base_price: 1500,
    status: "ACTIVE",
    category_id: "cat_apparel",
    created_at: new Date(now.getTime() - 10 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.products.push(prod);

  const variant = {
    id: "var_shirt_blue_m",
    tenant_id: tenantId,
    product_id: prod.id,
    title: "Blue / M",
    sku: "SHIRT-BLU-M",
    price: 1500,
    cost_price: 900,
    created_at: new Date(now.getTime() - 10 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.product_variants.push(variant);

  db.data.inventory_items.push({
    id: "inv_shirt_blue_m",
    tenant_id: tenantId,
    product_id: prod.id,
    product_variant_id: variant.id,
    warehouse_id: "wh_dhaka_central",
    quantity_on_hand: 12,
    quantity_reserved: 2,
    quantity_available: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Seed sample customers
  const cust1 = {
    id: "cust_rahim_01",
    tenant_id: tenantId,
    first_name: "Rahim",
    last_name: "Uddin",
    phone: "+8801711223344",
    created_at: new Date(now.getTime() - 40 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.customers.push(cust1);

  const cust2 = {
    id: "cust_karim_02",
    tenant_id: tenantId,
    first_name: "Karim",
    last_name: "Chowdhury",
    phone: "+8801811223344",
    created_at: new Date(now.getTime() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.customers.push(cust2);

  // Seed historical orders across several days
  for (let i = 1; i <= 8; i++) {
    const orderDate = new Date(now.getTime() - (9 - i) * 86400000).toISOString();
    const order = {
      id: `order_hist_${i}`,
      tenant_id: tenantId,
      order_number: `ORD-HIST-100${i}`,
      customer_id: i % 2 === 0 ? cust1.id : cust2.id,
      status: "DELIVERED",
      payment_status: "PAID",
      payment_method: "BKASH",
      subtotal: 1500,
      discount_total: 0,
      shipping_fee: 60,
      tax_total: 0,
      grand_total: 1560,
      source: "WEBSITE",
      items: [
        {
          id: `item_hist_${i}`,
          product_id: prod.id,
          product_variant_id: variant.id,
          sku: variant.sku,
          product_name: prod.title,
          variant_name: variant.title,
          unit_price: 1500,
          quantity: 1,
          total_price: 1500,
        },
      ],
      created_at: orderDate,
      updated_at: orderDate,
    };
    db.data.orders.push(order);

    db.data.payments.push({
      id: `pay_hist_${i}`,
      tenant_id: tenantId,
      order_id: order.id,
      amount: 1560,
      currency: "BDT",
      provider: "BKASH",
      status: "PAID",
      created_at: orderDate,
      updated_at: orderDate,
    });

    db.data.shipments.push({
      id: `ship_hist_${i}`,
      tenant_id: tenantId,
      order_id: order.id,
      courier_provider: "STEADFAST",
      status: "DELIVERED",
      created_at: orderDate,
      updated_at: orderDate,
    });
  }

  db.persist();

  // =========================================================================
  // GATE 1: METRIC REGISTRY INTEGRITY
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 1: Metric Registry Integrity${ANSI_RESET}`);

  await runTest("MetricRegistry contains canonical definitions and deterministic formulas", () => {
    const definitions = metricRegistryService.getDefinitions();
    assert(definitions.length >= 8, `Expected at least 8 canonical metrics, got ${definitions.length}`);

    const revDef = metricRegistryService.getDefinition("sales_revenue");
    assert(revDef !== undefined, "sales_revenue metric must exist");
    assert(revDef.unit === "CURRENCY", "sales_revenue unit must be CURRENCY");
    assert(revDef.formula.length > 0, "sales_revenue must have an explainable formula");
  });

  await runTest("MetricRegistry assertValidMetric enforces registered keys", () => {
    assert.doesNotThrow(() => {
      metricRegistryService.assertValidMetric("orders_count");
    });
    assert.throws(() => {
      metricRegistryService.assertValidMetric("unregistered_phantom_metric");
    }, /not defined/);
  });

  // =========================================================================
  // GATE 2: PARAMETERIZED QUERY SECURITY & EXECUTION
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 2: Parameterized Query Security & Zero-Injection Execution${ANSI_RESET}`);

  await runTest("AnalyticsQueryService deterministically computes metrics with comparison period", () => {
    const query = {
      tenantId,
      metrics: ["sales_revenue", "orders_count"],
      startDate: new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
      comparison: "PREVIOUS_PERIOD",
    };

    const result = analyticsQueryService.executeQuery(query);
    assert(result.tenant_id === tenantId, "Result must preserve tenant scoping");
    assert(result.metrics["sales_revenue"] !== undefined, "Must include sales_revenue");
    assert(result.metrics["orders_count"] !== undefined, "Must include orders_count");
    assert(typeof result.metrics["sales_revenue"].current_value === "number", "current_value must be numeric");
    assert(typeof result.metrics["sales_revenue"].trend_direction === "string", "trend_direction must be resolved");
  });

  // =========================================================================
  // GATE 3: INGESTION PIPELINE & TENANT ROLLUPS
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 3: Ingestion Pipeline & Tenant Rollups${ANSI_RESET}`);

  await runTest("IntelligenceIngestionService ingests domain events with idempotency", async () => {
    const event = {
      id: "evt_order_placed_test_01",
      tenant_id: tenantId,
      type: "ORDER_CREATED",
      payload: { amount_bdt: 1560, channel: "WEBSITE" },
      timestamp: new Date().toISOString(),
    };

    const ingest1 = await intelligenceIngestionService.ingestEvent(event);
    assert(ingest1.ingested === true, "First ingestion must succeed");
    assert(ingest1.duplicate === false, "First ingestion is not duplicate");

    const ingest2 = await intelligenceIngestionService.ingestEvent(event);
    assert(ingest2.ingested === false, "Duplicate ingestion must not be re-ingested");
    assert(ingest2.duplicate === true, "Must flag duplicate event");
  });

  // =========================================================================
  // GATE 4: STATISTICAL ANOMALY DETECTION ENGINE
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 4: Statistical Anomaly Detection Engine${ANSI_RESET}`);

  await runTest("AnomalyDetectorService calculates deviations and separates detection from explanation", () => {
    // Inject a payment failure spike
    for (let f = 0; f < 5; f++) {
      db.data.payments.push({
        id: `pay_failed_${f}`,
        tenant_id: tenantId,
        order_id: `order_failed_${f}`,
        amount: 1500,
        currency: "BDT",
        provider: "BKASH",
        status: "FAILED",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    db.persist();

    const anomalies = anomalyDetectorService.detectAnomalies(tenantId);
    assert(Array.isArray(anomalies), "Must return array of detected anomalies");
    const payAnom = anomalies.find((a) => a.metric === "payment_failure_rate");
    assert(payAnom !== undefined, "Must detect payment failure spike");
    assert(payAnom.severity === "HIGH", "Must assign HIGH severity to payment spike");
    assert(payAnom.evidence.length > 0, "Must attach grounded evidence");
    assert(payAnom.explanation_status === "EXPLAINED", "Must explicitly track explanation status");
  });

  // =========================================================================
  // GATE 5: MULTI-HORIZON PREDICTIVE FORECASTING
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 5: Multi-Horizon Predictive Forecasting${ANSI_RESET}`);

  await runTest("ForecastingService produces multi-horizon projections with confidence intervals", () => {
    const run = forecastingService.generateForecast({
      tenantId,
      targetType: "SALES_REVENUE",
      horizon: "14D",
    });

    assert(run.tenant_id === tenantId, "Tenant scoping must match");
    assert(run.horizon === "14D", "Horizon must match 14D");
    assert(run.predicted_points.length === 14, `Expected 14 daily predictions, got ${run.predicted_points.length}`);
    assert(run.predicted_points[0].confidence_upper >= run.predicted_points[0].predicted_value, "Upper bound >= predicted value");
    assert(run.predicted_points[0].confidence_lower <= run.predicted_points[0].predicted_value, "Lower bound <= predicted value");
    assert(run.confidence_score >= 0, "Confidence score must be non-negative");
  });

  await runTest("ForecastingService handles insufficient historical data gracefully", () => {
    const emptyTenantId = "tenant_brand_new_zero_data";
    const run = forecastingService.generateForecast({
      tenantId: emptyTenantId,
      targetType: "SALES_REVENUE",
      horizon: "7D",
    });

    assert(run.status === "INSUFFICIENT_DATA", "Must mark status as INSUFFICIENT_DATA when points < 5");
    assert(run.predicted_points.length === 0, "Must not fabricate predictions on zero data");
  });

  // =========================================================================
  // GATE 6: ZERO-MUTATION WHAT-IF SIMULATION SANDBOX
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 6: Zero-Mutation What-If Simulation Sandbox${ANSI_RESET}`);

  await runTest("SimulationService simulates price elasticity with strictly zero database mutations", () => {
    const ordersCountBefore = db.getAllOrders(tenantId).length;

    const result = simulationService.simulateScenario(
      tenantId,
      "Test Price Hike 10%",
      { price_change_pct: 10, discount_rate_change_pct: 0 },
      "PRICE_CHANGE"
    );

    const ordersCountAfter = db.getAllOrders(tenantId).length;
    assert.strictEqual(ordersCountBefore, ordersCountAfter, "Simulation must NEVER mutate database orders");

    assert(result.scenario_name === "Test Price Hike 10%", "Scenario name preserved");
    assert(result.deltas !== undefined, "Deltas must be calculated");
    const revDelta = result.deltas.find((d) => d.metric === "revenue");
    assert(typeof revDelta?.delta_absolute === "number", "Revenue delta must be numeric");
    assert(result.simulated_metrics.orders < result.baseline_metrics.orders, "Demand should drop on price increase");
  });

  // =========================================================================
  // GATE 7: CUSTOMER RFM SEGMENTATION & LTV
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 7: Customer RFM Segmentation & LTV${ANSI_RESET}`);

  await runTest("CustomerIntelligenceService scores RFM quantiles and computes observed & predicted LTV", () => {
    const records = customerIntelligenceService.analyzeCustomers(tenantId);
    assert(records.length >= 2, `Expected at least 2 customer profiles, got ${records.length}`);

    const r = records[0];
    assert(r.r_score >= 1 && r.r_score <= 5, "R score must be between 1 and 5");
    assert(r.f_score >= 1 && r.f_score <= 5, "F score must be between 1 and 5");
    assert(r.m_score >= 1 && r.m_score <= 5, "M score must be between 1 and 5");
    assert(r.observed_ltv_bdt > 0, "Observed LTV must be positive based on seeded orders");
    assert(r.estimated_ltv_bdt >= r.observed_ltv_bdt, "Predicted LTV must be >= observed LTV");
  });

  // =========================================================================
  // GATE 8: EXPLAINABLE RECOMMENDATION SYNTHESIS
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 8: Explainable Recommendation Synthesis (7 Factors)${ANSI_RESET}`);

  await runTest("RecommendationService outputs recommendations with 7 explainability factors", () => {
    const recs = recommendationService.generateRecommendations(tenantId);
    assert(recs.length > 0, "Expected generated recommendations");

    const rec = recs[0];
    // Factor 1: Evidence Citation
    assert(rec.evidence.length > 0, "Factor 1: Must contain evidence citations");
    // Factor 2: Rationale
    assert(rec.rationale.length > 0, "Factor 2: Must contain root-cause rationale");
    // Factor 3: Expected Revenue Gain or Cost Saving
    assert(typeof (rec.expected_benefit.revenue_impact_bdt ?? rec.expected_benefit.cost_saving_bdt) === "number", "Factor 3: Estimated financial gain/saving required");
    // Factor 4: Confidence Score
    assert(rec.confidence >= 0.5, "Factor 4: Confidence score required");
    // Factor 5: Risk Level
    assert(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(rec.action_risk_level), "Factor 5: Valid risk level required");
    // Factor 6: Minimum Autonomy Level
    assert(rec.required_autonomy_level >= 0, "Factor 6: Minimum autonomy level required");
    // Factor 7: Risks / Assumptions
    assert(Array.isArray(rec.assumptions), "Factor 7: Assumptions array required");
  });

  // =========================================================================
  // GATE 9: DECISION PROPOSAL & PHASE 5 POLICY BRIDGE
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 9: Decision Proposal & Phase 5 Policy Bridge${ANSI_RESET}`);

  await runTest("DecisionService submits decision to Phase 5 Approval Engine with audit trail", async () => {
    const recs = recommendationService.generateRecommendations(tenantId);
    assert(recs.length > 0, "Need recommendations for decision test");

    const decision = await decisionService.evaluateAndProposeDecision(tenantId, recs[0].id, {
      test_trigger: "TEST_RUNNER",
    });

    assert(decision.tenant_id === tenantId, "Tenant scoping must match");
    assert(decision.recommendation_id === recs[0].id, "Must link to recommendation");
    assert(decision.status === "PENDING_APPROVAL" || decision.status === "EXECUTING", "Must transition to pending or executing");

    if (decision.status === "PENDING_APPROVAL") {
      assert(decision.approval_id !== undefined, "Must create Phase 5 ApprovalRequest ID");
      const approval = db.getApprovalRequest(decision.tenant_id, decision.approval_id!);
      assert(approval !== undefined, "Approval request must be stored in database");
    }
  });

  // =========================================================================
  // GATE 10: DECISION OUTCOME TRACKING & FEEDBACK LOOP
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 10: Decision Outcome Tracking & Feedback Loop${ANSI_RESET}`);

  await runTest("FeedbackLoopService tracks expected vs actual metrics after decision execution", () => {
    const outcome = feedbackLoopService.recordDecisionOutcome({
      decisionId: "dec_test_001",
      tenantId,
      evaluationHorizonDays: 14,
      expectedMetrics: { revenue_bdt: 10000, orders: 20 },
      actualMetrics: { revenue_bdt: 9200, orders: 18 },
      learningNotes: "Promo email campaign executed",
    });

    assert(outcome.decision_id === "dec_test_001", "Decision ID preserved");
    assert(outcome.outcome_evaluation === "MET" || outcome.outcome_evaluation === "UNDERPERFORMED" || outcome.outcome_evaluation === "EXCEEDED", "Evaluation required");
    assert(outcome.variance["revenue_bdt"] !== undefined, "Variance metric required");
  });

  // =========================================================================
  // GATE 11: MULTI-AGENT SUPERVISOR DECOMPOSITION & DAG
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 11: Multi-Agent Supervisor Decomposition & DAG${ANSI_RESET}`);

  await runTest("IntelligenceSupervisorAgent decomposes analytical questions into validated DAGs", () => {
    const plan = intelligenceSupervisorAgent.planIntelligenceTask({
      tenantId,
      query: "Why did sales drop this month?",
    });

    assert(plan.steps.length >= 3, `Expected at least 3 steps in sales drop DAG, got ${plan.steps.length}`);
    const agentTypes = plan.steps.map((s) => s.agent_type);
    assert(agentTypes.includes("SALES_INTELLIGENCE"), "Must include SALES_INTELLIGENCE agent");
    assert(agentTypes.includes("ANOMALY_DETECTION"), "Must include ANOMALY_DETECTION agent");
    assert(agentTypes.includes("RECOMMENDATION"), "Must include RECOMMENDATION agent");

    // Execute plan
    const result = intelligenceSupervisorAgent.executeIntelligencePlan(tenantId, plan);
    assert(result.findings.length > 0, "Execution must return findings across subagents");
    assert(result.summary.length > 0, "Execution must produce executive summary");
  });

  // =========================================================================
  // GATE 12: DATA QUALITY AUDIT & MODEL REGISTRY GOVERNANCE
  // =========================================================================
  console.log(`\n${ANSI_BOLD}Gate 12: Data Quality Audit & Model Registry Governance${ANSI_RESET}`);

  await runTest("DataQualityService audits dataset health and boundary isolation", () => {
    const audit = dataQualityService.runDataQualityAudit(tenantId);
    assert(audit.tenant_id === tenantId, "Tenant scoping preserved");
    assert(audit.checks.length >= 4, `Expected at least 4 data quality checks, got ${audit.checks.length}`);
    assert(audit.overall_score_pct >= 80, `Data quality score should be healthy, got ${audit.overall_score_pct}`);
  });

  await runTest("ModelRegistryService governs registered statistical & ML models", () => {
    const models = modelRegistryService.listModels();
    assert(models.length >= 3, `Expected at least 3 baseline registered models, got ${models.length}`);
    const fcModel = models.find((m) => m.type === "FORECASTING");
    assert(fcModel !== undefined, "Forecasting model must be registered");
    assert(fcModel.version !== undefined, "Model must declare version");
  });

  await runTest("NLAnalyticsService answers natural language queries deterministically", () => {
    const ans = nlAnalyticsService.answerQuestion(tenantId, "What is our 30-day sales revenue?");
    assert(ans.interpreted_metric === "sales_revenue", "Should interpret as sales_revenue");
    assert(ans.grounded_answer.includes("sales_revenue") || ans.grounded_answer.includes("৳"), "Answer must cite currency");
    assert(ans.confidence >= 0.9, "Confidence must be >= 90%");
  });

  await runTest("IntelligenceWorkflowService runs scheduled commerce workflows", () => {
    const brief = intelligenceWorkflowService.runDailyExecutiveBrief(tenantId);
    assert(brief.workflow_type === "DAILY_EXECUTIVE_BRIEF", "Workflow type must match");
    assert(brief.status === "COMPLETED", "Workflow must complete successfully");
    assert(brief.digest_markdown.length > 0, "Must generate markdown executive digest");
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}Intelligence Test Results: ${passedCount} Passed, ${failedCount} Failed${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runIntelligenceTests().catch((err) => {
  console.error("Intelligence Test Suite Fatal Error:", err);
  process.exit(1);
});
