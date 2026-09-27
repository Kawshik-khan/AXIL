// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { audienceService, segmentEngineService } from "@/domains/growth/services/audience.service";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { journeyEngineService } from "@/domains/growth/services/journey-engine.service";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { consentService, frequencyCappingService } from "@/domains/growth/services/consent.service";
import { contentService } from "@/domains/growth/services/content.service";
import { offerService } from "@/domains/growth/services/offer.service";
import { productRecommendationService } from "@/domains/growth/services/product-recommendation.service";
import { experimentService } from "@/domains/growth/services/experiment.service";
import { attributionService } from "@/domains/growth/services/attribution.service";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";
import { growthWorkflowService } from "@/domains/growth/services/growth-workflow.service";
import { growthSupervisorAgent } from "@/domains/growth/agents/growth-supervisor.agent";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { ActionRiskLevel } from "@/types/orchestration";

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

export async function runGrowthTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 7: AUTONOMOUS GROWTH ENGINE TEST SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_growth_test_01";

  // Reset and seed database for deterministic test runs
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // 1. Seed sample customers
  const cust1 = {
    id: "cust_vip_01",
    tenant_id: tenantId,
    first_name: "Rahim",
    last_name: "Uddin",
    phone: "01711000001",
    email: "rahim@example.com",
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const cust2 = {
    id: "cust_dormant_02",
    tenant_id: tenantId,
    first_name: "Karim",
    last_name: "Chowdhury",
    phone: "01811000002",
    email: "karim@example.com",
    created_at: new Date(Date.now() - 120 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const cust3 = {
    id: "cust_new_03",
    tenant_id: tenantId,
    first_name: "Fatima",
    last_name: "Begum",
    phone: "01911000003",
    email: "fatima@example.com",
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.createCustomer(cust1);
  db.createCustomer(cust2);
  db.createCustomer(cust3);

  // 2. Seed orders for customer 1 and 2
  const order1 = {
    id: "ord_g1",
    order_number: "ORD-G1",
    tenant_id: tenantId,
    customer_id: cust1.id,
    status: "DELIVERED",
    payment_status: "PAID",
    total_amount: 3500,
    grand_total: 3500,
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const items1 = [
    { id: "item_1", tenant_id: tenantId, order_id: "ord_g1", product_id: "prod_shirt_101", quantity: 2, unit_price: 1750, total_price: 3500 },
  ];

  const order2 = {
    id: "ord_g2",
    order_number: "ORD-G2",
    tenant_id: tenantId,
    customer_id: cust1.id,
    status: "DELIVERED",
    payment_status: "PAID",
    total_amount: 4500,
    grand_total: 4500,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const items2 = [
    { id: "item_2", tenant_id: tenantId, order_id: "ord_g2", product_id: "prod_pant_202", quantity: 1, unit_price: 4500, total_price: 4500 },
  ];

  const order3 = {
    id: "ord_g3",
    order_number: "ORD-G3",
    tenant_id: tenantId,
    customer_id: cust2.id,
    status: "DELIVERED",
    payment_status: "PAID",
    total_amount: 12000,
    grand_total: 12000,
    created_at: new Date(Date.now() - 65 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const items3 = [
    { id: "item_3", tenant_id: tenantId, order_id: "ord_g3", product_id: "prod_shirt_101", quantity: 5, unit_price: 2400, total_price: 12000 },
  ];

  db.createOrder(order1, items1);
  db.createOrder(order2, items2);
  db.createOrder(order3, items3);

  // Seed product in catalog with stock
  const prod1 = {
    id: "prod_shirt_101",
    tenant_id: tenantId,
    name: "Premium Oxford Shirt",
    slug: "premium-oxford-shirt",
    base_price: 1500,
    is_active: true,
    variants: [{ id: "var_shirt_l", product_id: "prod_shirt_101", tenant_id: tenantId, name: "Large", sku: "SHIRT-L", price: 1500, stock: 25 }],
  };
  const prod2 = {
    id: "prod_pant_202",
    tenant_id: tenantId,
    name: "Classic Chino Pant",
    slug: "classic-chino-pant",
    base_price: 2200,
    is_active: true,
    variants: [{ id: "var_chino_32", product_id: "prod_pant_202", tenant_id: tenantId, name: "32 Navy", sku: "CHINO-32", price: 2200, stock: 15 }],
  };
  db.createProduct(prod1, 25);
  db.createProduct(prod2, 15);

  // ============================================================
  // Gate 1: Audience Management & Rule Evaluation
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 1: Audience Management & Dynamic Segmentation${ANSI_RESET}`);

  await runTest("Audience Rule Engine matches high-spend repeat customers (AND group)", () => {
    const audience = audienceService.createAudience({
      tenantId,
      name: "High Spend Repeat VIPs",
      description: "Customers with >= 2 orders and >= ৳5000 spend",
      type: "DYNAMIC",
      ruleGroups: [
        {
          conjunction: "AND",
          conditions: [
            { field: "order_count", operator: "GREATER_THAN_OR_EQUAL", value: 2 },
            { field: "total_spend", operator: "GREATER_THAN_OR_EQUAL", value: 5000 },
          ],
        },
      ],
    });

    assert.ok(audience.id, "Audience ID must be generated");
    const evaluated = audienceService.evaluateAudienceMembership(tenantId, audience);
    assert.strictEqual(evaluated.memberIds.length, 1, "Only Rahim (cust1) matches >=2 orders and >=৳5000 spend");
    assert.strictEqual(evaluated.memberIds[0], cust1.id);
  });

  await runTest("Audience Snapshot creates immutable member list and cryptographic hash", () => {
    const aud = audienceService.listAudiences(tenantId)[0];
    const snapshot = audienceService.createAudienceSnapshot(tenantId, aud.id, "cmp_test_101");
    assert.ok(snapshot.id, "Snapshot ID must exist");
    assert.strictEqual(snapshot.member_count, 1);
    assert.ok(snapshot.snapshot_hash.startsWith("sha256_"), "Snapshot must record sha256 hash");
    assert.deepStrictEqual(snapshot.customer_ids, [cust1.id]);
  });

  // ============================================================
  // Gate 2: 10-Stage Deterministic Customer Lifecycle Engine
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 2: 10-Stage Deterministic Customer Lifecycle State Machine${ANSI_RESET}`);

  await runTest("Determines correct lifecycle stages: PROSPECT, REPEAT, and DORMANT", () => {
    const stageNew = customerLifecycleService.determineLifecycleStage({
      orderCount: 0,
      daysSinceLastOrder: 999,
      totalSpendBdt: 0,
    });
    assert.strictEqual(stageNew, "PROSPECT", "Customer with 0 orders must be PROSPECT");

    const stageRepeat = customerLifecycleService.determineLifecycleStage({
      orderCount: 2,
      daysSinceLastOrder: 10,
      totalSpendBdt: 8000,
    });
    assert.strictEqual(stageRepeat, "REPEAT", "Customer with 2 recent orders must be REPEAT");

    const stageDormant = customerLifecycleService.determineLifecycleStage({
      orderCount: 1,
      daysSinceLastOrder: 65,
      totalSpendBdt: 12000,
    });
    assert.strictEqual(stageDormant, "DORMANT", "Customer with >60 days since order must be DORMANT");
  });

  await runTest("Evaluates customer lifecycle and persists transition audit events", () => {
    const lc1 = customerLifecycleService.evaluateCustomerLifecycle(tenantId, cust1.id);
    assert.strictEqual(lc1.stage, "REPEAT");
    assert.strictEqual(lc1.order_count, 2);
    assert.strictEqual(lc1.total_revenue_bdt, 8000);

    const lc2 = customerLifecycleService.evaluateCustomerLifecycle(tenantId, cust2.id);
    assert.strictEqual(lc2.stage, "DORMANT");

    const transitions = db.getLifecycleTransitions(tenantId);
    assert.ok(transitions.length >= 2, "Transition records must be persisted in database");
  });

  // ============================================================
  // Gate 3: Customer Journey Engine & Durable Execution
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 3: Customer Journey Engine & Multi-Node DAG${ANSI_RESET}`);

  await runTest("Constructs multi-node journey with TRIGGER, WAIT, ACTION, and EXIT", async () => {
    const journey = journeyEngineService.createJourney({
      tenantId,
      name: "Post-Purchase Welcome Journey",
      description: "Onboards first-time purchasers",
      triggerEvent: "ORDER_DELIVERED",
      steps: [
        {
          id: "step_1_wait",
          type: "WAIT",
          title: "Wait 1 day",
          config: { wait_duration_minutes: 1440 },
          next_step_id: "step_2_msg",
        },
        {
          id: "step_2_msg",
          type: "ACTION",
          title: "Send WhatsApp Welcome Care Message",
          config: {
            action_type: "SEND_MESSAGE",
            channel: "WHATSAPP",
          },
          next_step_id: "step_3_exit",
        },
        {
          id: "step_3_exit",
          type: "EXIT",
          title: "Complete Journey",
          config: { exit_reason: "SUCCESSFULLY_NURTURED" },
        },
      ],
    });

    assert.ok(journey.id, "Journey ID required");
    assert.strictEqual(journey.steps.length, 3);

    const enrollment = journeyEngineService.enrollCustomer({
      tenantId,
      journeyId: journey.id,
      customerId: cust1.id,
      contextData: { order_id: "ord_g2" },
    });

    assert.strictEqual(enrollment.status, "ENROLLED");
    assert.strictEqual(enrollment.current_step_id, "step_1_wait");

    // Advance step 1: WAIT node holds execution until wait_until
    const advanced = await journeyEngineService.advanceEnrollment(tenantId, enrollment.id);
    assert.strictEqual(advanced.status, "WAITING");
    assert.ok(advanced.wait_until, "wait_until must be set");
  });

  // ============================================================
  // Gate 4: Campaign Risk Classification & Approval Gating
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 4: Campaign Governance, Risk Gating & Execution${ANSI_RESET}`);

  let highRiskCampaignId = "";

  await runTest("Evaluates campaign risk level according to budget and discount boundaries", () => {
    const lowRisk = campaignService.evaluateRiskTier({
      audienceSize: 20,
      budgetBdt: 3000,
      discountValue: 10,
      discountType: "PERCENTAGE",
    });
    assert.strictEqual(lowRisk.riskClass, "LOW");
    assert.strictEqual(lowRisk.requiresApproval, false);

    const highRisk = campaignService.evaluateRiskTier({
      audienceSize: 600,
      budgetBdt: 15000,
      discountValue: 20,
      discountType: "PERCENTAGE",
    });
    assert.strictEqual(highRisk.riskClass, "HIGH");
    assert.strictEqual(highRisk.requiresApproval, true);
    assert.strictEqual(highRisk.riskLevel, ActionRiskLevel.HIGH);
  });

  await runTest("Blocks high-risk campaign execution until Phase 5 merchant approval", async () => {
    const aud = audienceService.listAudiences(tenantId)[0];
    const campaign = campaignService.createCampaign({
      tenantId,
      name: "High-Budget Flash Sale",
      objective: "CONVERSION",
      audienceId: aud.id,
      channel: "WHATSAPP",
      budgetBdt: 25000,
      variants: [
        {
          id: "var_1",
          name: "Variant A",
          subject_or_title: "Flash Sale",
          content_body: "Huge sale for our VIP customers!",
          call_to_action: "Shop Now",
          allocation_pct: 100,
        },
      ],
    });

    highRiskCampaignId = campaign.id;
    assert.strictEqual(campaign.required_approval, true);
    assert.strictEqual(campaign.status, "DRAFT");

    // Submit for approval
    const requested = campaignService.requestCampaignApproval(tenantId, campaign.id, "MERCHANT");
    assert.strictEqual(requested.status, "REVIEW");
    assert.ok(requested.approval_request_id, "Approval request ID must be attached");

    // Attempt execution before approval -> MUST THROW
    await assert.rejects(
      async () => {
        await campaignService.executeCampaign(tenantId, campaign.id);
      },
      /Policy violation: High-risk campaign requires human merchant approval/,
      "Must reject execution of unapproved high-risk campaign"
    );

    // Merchant Approves
    const approved = campaignService.approveCampaign(tenantId, campaign.id, "merchant_user_1");
    assert.strictEqual(approved.status, "APPROVED");

    // Execution now succeeds
    const execResult = await campaignService.executeCampaign(tenantId, campaign.id);
    assert.ok(execResult.messages_sent >= 1, "Messages should be sent");
    assert.ok(execResult.attributed_revenue_bdt > 0, "Attributed revenue computed");
  });

  // ============================================================
  // Gate 5: Consent Verification & Multi-Channel Frequency Capping
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 5: Consent Verification & Multi-Channel Frequency Capping${ANSI_RESET}`);

  await runTest("Enforces opt-in and opt-out preferences across marketing channels", () => {
    consentService.setPreference({
      tenantId,
      customerId: cust1.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: "OPTED_IN",
    });

    consentService.setPreference({
      tenantId,
      customerId: cust1.id,
      channel: "EMAIL",
      purpose: "MARKETING",
      status: "OPTED_OUT",
    });

    assert.strictEqual(consentService.hasConsent(tenantId, cust1.id, "WHATSAPP"), true);
    assert.strictEqual(consentService.hasConsent(tenantId, cust1.id, "EMAIL"), false);
  });

  await runTest("Enforces daily and weekly frequency caps", () => {
    const policy = { max_messages_per_day: 1, max_messages_per_week: 3, cooldown_period_hours: 12 };
    // Create conversation and mock sent message
    const conv = db.createConversation({
      id: "conv_test_cap_1",
      tenant_id: tenantId,
      customer_id: cust1.id,
      channel_id: "chan_wa_1",
      channel_type: "WHATSAPP",
      external_conversation_id: "ext_wa_1",
      status: "OPEN",
      unread_count: 0,
      tags: [],
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.createMessage({
      id: "msg_cap_1",
      tenant_id: tenantId,
      conversation_id: conv.id,
      channel_id: "chan_wa_1",
      sender_id: "agent_1",
      sender_type: "AGENT",
      content_type: "TEXT",
      body: "Marketing message 1",
      status: "DELIVERED",
      created_at: new Date().toISOString(),
      metadata: { is_marketing: true },
    });

    const capCheck = frequencyCappingService.checkFrequencyCap(tenantId, cust1.id, "WHATSAPP", policy);
    assert.strictEqual(capCheck.capped, true, "Should be capped after hitting daily limit");
  });

  // ============================================================
  // Gate 6: Grounded Content Generation & Commerce Factuality
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 6: Content Generation & Commerce Factuality Verification${ANSI_RESET}`);

  await runTest("Generates grounded Banglish copy with accurate catalog price", () => {
    const copy = contentService.generateCopyDraft({
      tenantId,
      channel: "WHATSAPP",
      language: "banglish",
      customerName: "Rahim",
      productId: prod1.id,
      category: "PROMOTIONAL",
    });

    assert.ok(copy.rendered_text.includes("Premium Oxford Shirt"), "Must ground product name");
    assert.ok(copy.rendered_text.includes("1500"), "Must ground exact catalog price");
    assert.strictEqual(copy.verification_passed, true);
  });

  await runTest("Catches false claimed prices and fake promotional codes", () => {
    // 1. Price mismatch
    const badPriceCheck = contentService.verifyContentFactuality({
      tenantId,
      text: "Get Premium Oxford Shirt for only ৳999 today!",
      productId: prod1.id,
      claimedPrice: 999,
    });
    assert.strictEqual(badPriceCheck.is_valid, false);
    assert.strictEqual(badPriceCheck.price_verified, false);

    // 2. Fake promo code
    const fakeCodeCheck = contentService.verifyContentFactuality({
      tenantId,
      text: "Use code FAKE999 for discount",
      productId: prod1.id,
      offerCode: "NON_EXISTENT_COUPON_999",
    });
    assert.strictEqual(fakeCodeCheck.is_valid, false);
    assert.ok(fakeCodeCheck.violations.some((v) => v.includes("is neither an active Offer nor a valid Coupon")));
  });

  // ============================================================
  // Gate 7: Offer Simulation & Margin Floor Protection
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 7: Offer Simulation & Margin Floor Protection${ANSI_RESET}`);

  await runTest("Simulates offer revenue impact via Phase 6 elasticity engine", () => {
    const offer = offerService.createOffer({
      id: "off_comeback_15",
      tenant_id: tenantId,
      code: "COMEBACK15",
      title: "15% Comeback Discount",
      description: "For win-back campaigns",
      type: "PERCENTAGE",
      value: 15,
      rules: { min_cart_value_bdt: 1000, margin_floor_pct: 15 },
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      is_active: true,
      current_usage_count: 0,
      created_at: new Date().toISOString(),
    });

    const sim = offerService.simulateOffer(tenantId, offer);
    assert.ok(sim.projected_gross_revenue_bdt > 0);
    assert.strictEqual(typeof sim.margin_safe, "boolean");
  });

  await runTest("Validates cart eligibility and usage restrictions", () => {
    const eligibleCheck = offerService.validateOfferEligibility({
      tenantId,
      offerCode: "COMEBACK15",
      customerId: cust1.id,
      cartTotalBdt: 2500,
    });

    assert.strictEqual(eligibleCheck.eligible, true);
    assert.strictEqual(eligibleCheck.discountAmountBdt, 375); // 15% of 2500
  });

  // ============================================================
  // Gate 8: Co-Purchase Affinity & Product Recommendations
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 8: Co-Purchase Affinity & Recommendation Engine${ANSI_RESET}`);

  await runTest("Generates cross-sell, upsell, and cart recovery recommendations", () => {
    const crossSells = productRecommendationService.getCrossSellRecommendations(tenantId, prod1.id);
    assert.ok(crossSells.length > 0, "Must return cross-sell candidate");
    assert.strictEqual(crossSells[0].type, "CROSS_SELL");

    const recovery = productRecommendationService.evaluateAbandonedCheckout({
      tenantId,
      customerId: cust3.id,
      cartItems: [{ product_id: prod1.id, title: prod1.name, price: 1500, quantity: 1 }],
    });

    assert.strictEqual(recovery.eligibleForRecovery, true);
    assert.ok(recovery.recoveryItem);
    assert.strictEqual(recovery.recoveryItem.abandoned_total_bdt, 1500);
  });

  // ============================================================
  // Gate 9: A/B Testing & Statistical Significance
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 9: A/B Testing & Statistical Significance Engine${ANSI_RESET}`);

  await runTest("Performs deterministic traffic split and p-value evaluation", () => {
    const exp = experimentService.createExperiment({
      tenantId,
      name: "Subject Line Urgency Test",
      hypothesis: "Urgency emojis increase open and conversion rates",
      primaryMetric: "CONVERSION_RATE",
      audienceId: "aud_test_1",
      variants: [
        { variant_id: "control", name: "Control Plain Text", description: "Regular greeting", traffic_allocation_pct: 50 },
        { variant_id: "variant_a", name: "Urgent Emoji Variant", description: "Urgent copy", traffic_allocation_pct: 50 },
      ],
      minSampleSize: 10,
    });

    // Deterministic assignment
    const asgn1 = experimentService.assignCustomerToVariant(tenantId, exp.id, "customer_alpha_99");
    const asgn2 = experimentService.assignCustomerToVariant(tenantId, exp.id, "customer_alpha_99");
    assert.strictEqual(asgn1.assigned_variant_id, asgn2.assigned_variant_id, "Same customer must deterministically get identical variant");

    // Assign enough customers to satisfy minSampleSize (10 per variant, 2 variants = 20 minimum)
    for (let i = 0; i < 20; i++) {
      const cId = `user_ctrl_${i}`;
      db.insertExperimentAssignment({
        id: `asg_ctrl_${i}`,
        tenant_id: tenantId,
        experiment_id: exp.id,
        customer_id: cId,
        assigned_variant_id: "control",
        assigned_at: new Date().toISOString(),
        has_converted: false,
      });
      if (i < 3) {
        experimentService.recordConversion({
          tenantId,
          experimentId: exp.id,
          customerId: cId,
          orderValueBdt: 1500,
        });
      }

      const vId = `user_var_${i}`;
      db.insertExperimentAssignment({
        id: `asg_var_${i}`,
        tenant_id: tenantId,
        experiment_id: exp.id,
        customer_id: vId,
        assigned_variant_id: "variant_a",
        assigned_at: new Date().toISOString(),
        has_converted: false,
      });
      if (i < 10) {
        experimentService.recordConversion({
          tenantId,
          experimentId: exp.id,
          customerId: vId,
          orderValueBdt: 1500,
        });
      }
    }

    const evalResult = experimentService.evaluateExperiment(tenantId, exp.id);
    assert.strictEqual(evalResult.winner_variant_id, "variant_a");
    assert.strictEqual(evalResult.status, "WINNER_DETERMINED");
    assert.strictEqual(typeof evalResult.variant_metrics["variant_a"].p_value, "number");
  });

  // ============================================================
  // Gate 10: Multi-Touch Attribution Modeling
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 10: Multi-Touch Attribution & Incremental Revenue${ANSI_RESET}`);

  await runTest("Calculates multi-touch attribution across LAST_TOUCH, FIRST_TOUCH, and LINEAR", () => {
    const touchpoints = [
      {
        campaign_id: "cmp_first",
        channel: "WHATSAPP" as const,
        touched_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      },
      {
        campaign_id: "cmp_last",
        channel: "INSTAGRAM" as const,
        touched_at: new Date(Date.now() - 1 * 86400000).toISOString(),
      },
    ];

    const orderAmount = 5000;

    const lastTouch = attributionService.attributeOrder({
      tenantId,
      orderId: "ord_attr_1",
      customerId: cust1.id,
      orderTotalBdt: orderAmount,
      touchpoints,
      model: "LAST_TOUCH",
    });
    assert.strictEqual(lastTouch.campaign_credits["cmp_last"].attributed_revenue_bdt, 5000);

    const firstTouch = attributionService.attributeOrder({
      tenantId,
      orderId: "ord_attr_2",
      customerId: cust1.id,
      orderTotalBdt: orderAmount,
      touchpoints,
      model: "FIRST_TOUCH",
    });
    assert.strictEqual(firstTouch.campaign_credits["cmp_first"].attributed_revenue_bdt, 5000);

    const linear = attributionService.attributeOrder({
      tenantId,
      orderId: "ord_attr_3",
      customerId: cust1.id,
      orderTotalBdt: orderAmount,
      touchpoints,
      model: "LINEAR",
    });
    assert.strictEqual(linear.campaign_credits["cmp_first"].attributed_revenue_bdt, 2500);
    assert.strictEqual(linear.campaign_credits["cmp_last"].attributed_revenue_bdt, 2500);
  });

  // ============================================================
  // Gate 11: 7-Factor Explainable Growth Recommendations
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 11: 7-Factor Explainable Growth Recommendations${ANSI_RESET}`);

  await runTest("Synthesizes explainable growth recommendations with all 7 required factors", () => {
    const recs = growthIntelligenceService.generateGrowthRecommendations(tenantId);
    assert.ok(recs.length > 0, "Must synthesize recommendations");

    const rec = recs[0];
    assert.ok(rec.title, "Factor 1: Title required");
    assert.ok(rec.strategy, "Factor 1: Strategy required");
    assert.ok(rec.target_audience_name, "Factor 2: Target audience required");
    assert.ok(rec.recommended_channel, "Factor 3: Recommended channel required");
    assert.ok(rec.rationale, "Factor 4: Rationale required");
    assert.ok(rec.evidence && rec.evidence.length > 0, "Factor 5: Evidence required");
    assert.ok(rec.expected_impact?.projected_revenue_bdt > 0, "Factor 6: Expected revenue impact required");
    assert.ok(rec.action_risk_level, "Factor 7: Action risk level required");
  });

  // ============================================================
  // Gate 12: Canonical Growth Workflows Execution
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 12: Canonical Growth Workflows Execution${ANSI_RESET}`);

  await runTest("Executes canonical growth workflows with completed status", async () => {
    const cartRecovery = await growthWorkflowService.runAbandonedCheckoutRecovery({
      tenantId,
      customerId: cust3.id,
      cartItems: [{ product_id: prod1.id, title: prod1.name, price: 1500, quantity: 1 }],
    });
    assert.strictEqual(cartRecovery.status, "COMPLETED");

    const winBack = await growthWorkflowService.runDormantWinBackWorkflow(tenantId);
    assert.strictEqual(winBack.status, "COMPLETED");

    const crossSell = await growthWorkflowService.runPostDeliveryCrossSell(tenantId, order1.id);
    assert.strictEqual(crossSell.status, "COMPLETED");

    const brief = growthWorkflowService.runDailyGrowthBrief(tenantId);
    assert.strictEqual(brief.status, "COMPLETED");
  });

  // ============================================================
  // Gate 13: Growth Supervisor Multi-Agent DAG & Tool Registry
  // ============================================================
  console.log(`\n${ANSI_BOLD}Gate 13: Growth Supervisor DAG Planning & Tool Registry${ANSI_RESET}`);

  await runTest("Supervisor decomposes commercial growth objective into validated DAG", () => {
    const steps = growthSupervisorAgent.decomposeGrowthObjective({
      objective: "Increase customer repeat purchase rate through tailored recommendations",
    });

    assert.ok(steps.length >= 4, "DAG must contain multi-agent steps");
    const taskTypes = steps.map((s) => s.task_type);
    assert.ok(taskTypes.includes("ANALYZE_REPEAT_RATE"));
    assert.ok(taskTypes.includes("IDENTIFY_SEGMENTS"));
    assert.ok(taskTypes.includes("IDENTIFY_PRODUCT_AFFINITY"));
    assert.ok(taskTypes.includes("DRAFT_PERSONALIZED_CAMPAIGN"));
  });

  await runTest("Verifies all 18 Phase 7 marketing tools registered in ToolRegistry", () => {
    const tools = toolRegistry.getToolsByCategory("MARKETING");
    assert.strictEqual(tools.length, 18, `Must have exactly 18 MARKETING tools registered, found ${tools.length}`);

    const toolNames = tools.map((t) => t.name);
    assert.ok(toolNames.includes("get_audience"));
    assert.ok(toolNames.includes("create_audience"));
    assert.ok(toolNames.includes("evaluate_segment"));
    assert.ok(toolNames.includes("get_customer_lifecycle"));
    assert.ok(toolNames.includes("get_product_recommendations"));
    assert.ok(toolNames.includes("get_campaign_metrics"));
    assert.ok(toolNames.includes("create_campaign_draft"));
    assert.ok(toolNames.includes("generate_content"));
    assert.ok(toolNames.includes("validate_content"));
    assert.ok(toolNames.includes("simulate_campaign"));
    assert.ok(toolNames.includes("check_consent"));
    assert.ok(toolNames.includes("check_frequency_cap"));
    assert.ok(toolNames.includes("schedule_campaign"));
    assert.ok(toolNames.includes("send_campaign"));
    assert.ok(toolNames.includes("pause_campaign"));
    assert.ok(toolNames.includes("resume_campaign"));
    assert.ok(toolNames.includes("get_campaign_result"));
    assert.ok(toolNames.includes("get_attribution"));
  });

  // Final Summary
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}Growth Test Results: ${passedCount} Passed, ${failedCount} Failed${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runGrowthTests().catch((err) => {
  console.error("Growth Test Suite Fatal Error:", err);
  process.exit(1);
});
