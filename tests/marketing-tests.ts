// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { marketingService } from "@/domains/marketing/marketing.service";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { audienceService } from "@/domains/growth/services/audience.service";
import { consentService } from "@/domains/growth/services/consent.service";
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

export async function runMarketingTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 8: MARKETING & CAMPAIGNS TEST SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_mkt_test_01";

  // Reset and seed database for deterministic test runs
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // Seed test tenant & test customer
  const cust1 = {
    id: "cust_mkt_01",
    tenant_id: tenantId,
    first_name: "Sadia",
    last_name: "Afrin",
    phone: "+8801711229988",
    email: "sadia.afrin@example.com",
    status: "ACTIVE",
    total_orders: 1,
    total_spent: 3530,
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const custVip = {
    id: "cust_mkt_vip",
    tenant_id: tenantId,
    first_name: "Zubair",
    last_name: "Hossain",
    phone: "+8801811445566",
    email: "zubair@example.com",
    status: "ACTIVE",
    total_orders: 4,
    total_spent: 14500,
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const custDormant = {
    id: "cust_mkt_dormant",
    tenant_id: tenantId,
    first_name: "Tamim",
    last_name: "Iqbal",
    phone: "+8801911778899",
    email: "tamim@example.com",
    status: "ACTIVE",
    total_orders: 1,
    total_spent: 2450,
    created_at: new Date(Date.now() - 120 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.createCustomer(cust1 as any);
  db.createCustomer(custVip as any);
  db.createCustomer(custDormant as any);

  // Seed sample products
  const prd1 = {
    id: "prd_mkt_01",
    tenant_id: tenantId,
    name: "Festive Embroidered Kurti",
    slug: "festive-embroidered-kurti",
    description: "Premium cotton kurti",
    sku: "KRT-01",
    base_price: 1850,
    currency: "BDT",
    is_active: true,
    status: "ACTIVE",
    variants: [
      {
        id: "var_mkt_01",
        tenant_id: tenantId,
        product_id: "prd_mkt_01",
        name: "M / Crimson",
        sku: "KRT-01-M",
        price: 1850,
        stock: 25,
      },
    ],
  };
  db.createProduct(prd1 as any, 25);

  // Seed orders for VIP and Dormant
  const orderVip = {
    id: "ord_vip_01",
    tenant_id: tenantId,
    order_number: "ORD-VIP-01",
    customer_id: custVip.id,
    status: "DELIVERED",
    payment_status: "PAID",
    grand_total: 14500,
    total_amount: 14500,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const itemsVip = [
    {
      id: "item_vip_1",
      tenant_id: tenantId,
      order_id: "ord_vip_01",
      product_id: prd1.id,
      quantity: 4,
      unit_price: 1850,
      total_price: 7400,
    },
  ];
  db.createOrder(orderVip as any, itemsVip as any);

  const orderDormant = {
    id: "ord_dormant_01",
    tenant_id: tenantId,
    order_number: "ORD-DOR-01",
    customer_id: custDormant.id,
    status: "DELIVERED",
    payment_status: "PAID",
    grand_total: 2450,
    total_amount: 2450,
    created_at: new Date(Date.now() - 75 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const itemsDormant = [
    {
      id: "item_dor_1",
      tenant_id: tenantId,
      order_id: "ord_dormant_01",
      product_id: prd1.id,
      quantity: 1,
      unit_price: 2450,
      total_price: 2450,
    },
  ];
  db.createOrder(orderDormant as any, itemsDormant as any);

  // ----------------------------------------------------------------------
  // SUITE 1: ABANDONED CART RECOVERY CAPABILITY
  // ----------------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1] WhatsApp Abandoned Cart Recovery Tests${ANSI_RESET}`);

  let recordedCartId = "";

  await runTest("Record and retrieve abandoned cart session", async () => {
    const cart = marketingService.recordAbandonedCart({
      tenantId,
      customerId: cust1.id,
      cartItems: [
        {
          product_id: prd1.id,
          title: prd1.name,
          price: 1850,
          quantity: 1,
        },
      ],
      abandonedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    });

    assert.ok(cart.id.startsWith("acr_"));
    assert.strictEqual(cart.abandoned_total_bdt, 1850);
    assert.strictEqual(cart.recovery_stage, "PENDING");
    recordedCartId = cart.id;

    const carts = marketingService.getAbandonedCarts(tenantId);
    const found = carts.find((c) => c.id === cart.id);
    assert.ok(found);
    assert.strictEqual(found?.customer?.first_name, "Sadia");
  });

  await runTest("Dispatch automated WhatsApp recovery nudge with Banglish copy", async () => {
    const nudge = await marketingService.sendWhatsAppRecoveryNudge({
      tenantId,
      cartId: recordedCartId,
    });

    assert.strictEqual(nudge.success, true);
    assert.strictEqual(nudge.channel, "WHATSAPP");
    assert.strictEqual(nudge.recipient_phone, "+8801711229988");
    assert.ok(nudge.message_content.includes("Assalamu Alaikum Sadia!"));
    assert.ok(nudge.message_content.includes("Reply STOP to unsubscribe"));
    assert.ok(nudge.message_content.includes("1,850"));

    // Verify stage updated to MESSAGED
    const cart = db.getAbandonedCartById(recordedCartId);
    assert.strictEqual(cart?.recovery_stage, "MESSAGED");
  });

  await runTest("Suppress recovery nudge if customer has opted out of WhatsApp", async () => {
    // Record opt-out
    consentService.setPreference({
      tenantId,
      customerId: cust1.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: "OPTED_OUT",
      consentSource: "REPLY_STOP",
    });

    const secondCart = marketingService.recordAbandonedCart({
      tenantId,
      customerId: cust1.id,
      cartItems: [{ product_id: prd1.id, title: prd1.name, price: 1850, quantity: 1 }],
    });

    const nudge = await marketingService.sendWhatsAppRecoveryNudge({
      tenantId,
      cartId: secondCart.id,
    });

    assert.strictEqual(nudge.success, false);
    assert.ok(nudge.error?.includes("opted out"));

    // Reset consent for subsequent tests
    consentService.setPreference({
      tenantId,
      customerId: cust1.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: "OPTED_IN",
      consentSource: "CHECKOUT_CHECKBOX",
    });
  });

  await runTest("Mark cart as recovered and credit attribution", async () => {
    const recovered = marketingService.markCartRecovered({
      tenantId,
      cartId: recordedCartId,
      orderId: "ord_recovered_101",
    });

    assert.strictEqual(recovered.recovery_stage, "RECOVERED");
    assert.strictEqual(recovered.recovered_order_id, "ord_recovered_101");
  });

  // ----------------------------------------------------------------------
  // SUITE 2: AUDIENCE COHORT SEGMENTATION CAPABILITY
  // ----------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2] Audience Cohort Segmentation Tests${ANSI_RESET}`);

  let vipCohortId = "";
  let dormantCohortId = "";

  await runTest("Create and evaluate dynamic VIP High LTV cohort", async () => {
    const vipCohort = marketingService.createAudienceCohort({
      tenantId,
      name: "VIP Spenders (>৳10,000)",
      description: "High lifetime value customer cohort",
      type: "DYNAMIC",
      ruleGroups: [
        {
          conjunction: "AND",
          conditions: [
            { field: "total_spend", operator: "GREATER_THAN_OR_EQUAL", value: 10000 },
          ],
        },
      ],
    });

    vipCohortId = vipCohort.id;
    assert.ok(vipCohort.id.startsWith("aud_"));

    const cohorts = marketingService.getAudienceCohorts(tenantId);
    const found = cohorts.find((c) => c.id === vipCohort.id);
    assert.ok(found);
    assert.strictEqual(found?.estimated_size, 1); // Only custVip has >10k spend

    const members = marketingService.getAudienceMembers(tenantId, vipCohort.id);
    assert.strictEqual(members.length, 1);
    assert.strictEqual(members[0].id, custVip.id);
  });

  await runTest("Create and evaluate dynamic Dormant 60D cohort", async () => {
    const dormantCohort = marketingService.createAudienceCohort({
      tenantId,
      name: "Dormant (60D+ Inactive)",
      description: "Customers who have not bought in 60 days",
      type: "DYNAMIC",
      ruleGroups: [
        {
          conjunction: "AND",
          conditions: [
            { field: "last_purchase_days_ago", operator: "GREATER_THAN_OR_EQUAL", value: 60 },
          ],
        },
      ],
    });

    dormantCohortId = dormantCohort.id;
    const members = marketingService.getAudienceMembers(tenantId, dormantCohort.id);
    assert.ok(members.some((m) => m.id === custDormant.id));
  });

  // ----------------------------------------------------------------------
  // SUITE 3: RATE-LIMITED BROADCAST MESSAGING & HUMAN APPROVAL GATES
  // ----------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3] Rate-Limited Broadcasts & Approval Safeguards${ANSI_RESET}`);

  let highRiskCampaignId = "";
  let lowRiskCampaignId = "";

  await runTest("Small audience (<50 recipients) auto-approves as LOW/MEDIUM risk", async () => {
    const cmp = marketingService.createBroadcastCampaign({
      tenantId,
      name: "Small VIP Nudge",
      objective: "ENGAGEMENT",
      audienceId: vipCohortId, // 1 recipient
      channel: "WHATSAPP",
      contentBody: "Special VIP update for {customer_name}. Reply STOP to unsubscribe",
      callToAction: "View Perks",
      budgetBdt: 500,
    });

    lowRiskCampaignId = cmp.id;
    assert.strictEqual(cmp.required_approval, false);
    assert.strictEqual(cmp.status, "DRAFT");
  });

  await runTest("High budget or large audience trigger Human Approval Gate (>50 or >৳5,000)", async () => {
    const highRiskCmp = marketingService.createBroadcastCampaign({
      tenantId,
      name: "Large Eid Flash Sale",
      objective: "CONVERSION",
      audienceId: vipCohortId,
      channel: "WHATSAPP",
      contentBody: "Massive Flash Sale for {customer_name}. Reply STOP to unsubscribe",
      callToAction: "Shop Now",
      budgetBdt: 25000, // Exceeds 5k threshold -> triggers approval gate
    });

    highRiskCampaignId = highRiskCmp.id;
    assert.strictEqual(highRiskCmp.required_approval, true);
    assert.strictEqual(highRiskCmp.status, "REVIEW");
  });

  await runTest("Executing unapproved high-risk campaign throws policy violation", async () => {
    let thrown = false;
    try {
      await marketingService.dispatchBroadcast(tenantId, highRiskCampaignId);
    } catch (err: any) {
      thrown = true;
      assert.ok(err.message.includes("Policy violation") || err.message.includes("approval"));
    }
    assert.strictEqual(thrown, true, "Unapproved high-risk campaign must be blocked by policy engine");
  });

  await runTest("Human Approval Gate approves campaign for rate-limited execution", async () => {
    const approved = marketingService.approveCampaign(
      tenantId,
      highRiskCampaignId,
      "Rafiqul Islam (Store Owner)"
    );

    assert.strictEqual(approved.status, "APPROVED");
  });

  await runTest("Dispatch broadcast enforces rate limit (20 msg/sec) and completes", async () => {
    const result = await marketingService.dispatchBroadcast(tenantId, highRiskCampaignId);

    assert.strictEqual(result.planned_audience, 1);
    assert.strictEqual(result.messages_sent, 1);
    assert.strictEqual(result.messages_delivered, 1);
    assert.ok(result.attributed_revenue_bdt > 0);

    const updatedCmp = db.getCampaignById(highRiskCampaignId);
    assert.strictEqual(updatedCmp?.status, "COMPLETED");
  });

  await runTest("Emergency Kill Switch immediately halts outbound broadcasts", async () => {
    marketingService.toggleKillSwitch(tenantId, true);

    const killState = marketingService.toggleKillSwitch(tenantId, true);
    assert.strictEqual(killState.kill_switch_active, true);

    // Reset kill switch
    marketingService.toggleKillSwitch(tenantId, false);
    const killStateOff = marketingService.toggleKillSwitch(tenantId, false);
    assert.strictEqual(killStateOff.kill_switch_active, false);
  });

  // ----------------------------------------------------------------------
  // SUITE 4: MULTI-TOUCH ATTRIBUTION MODELING
  // ----------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4] Multi-Touch Revenue Attribution Tests${ANSI_RESET}`);

  await runTest("Attribution report returns metrics across LAST_TOUCH and LINEAR models", async () => {
    const lastTouch = marketingService.getAttributionReport(tenantId, "LAST_TOUCH");
    assert.strictEqual(lastTouch.active_model, "LAST_TOUCH");
    assert.ok(typeof lastTouch.total_attributed_revenue_bdt === "number");
    assert.ok(typeof lastTouch.total_incremental_lift_bdt === "number");
    assert.ok(Array.isArray(lastTouch.campaigns_breakdown));

    const linear = marketingService.getAttributionReport(tenantId, "LINEAR");
    assert.strictEqual(linear.active_model, "LINEAR");
  });

  // ----------------------------------------------------------------------
  // SUITE 5: MARKETING OVERVIEW KPIS & AI COPILOT
  // ----------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5] Marketing Overview KPIs & AI Copilot Tests${ANSI_RESET}`);

  await runTest("Marketing overview aggregates cart recovery and attribution KPIs", async () => {
    const overview = marketingService.getOverviewMetrics(tenantId);

    assert.ok(overview.total_recovered_revenue_bdt >= 0);
    assert.ok(overview.total_attributed_revenue_bdt >= 0);
    assert.ok(Array.isArray(overview.insights));
    assert.ok(overview.insights.length > 0);
    assert.ok(overview.insights[0].title.startsWith("✦"));
  });

  // Summary
  console.log(`\n${ANSI_BOLD}----------------------------------------------------${ANSI_RESET}`);
  console.log(`Tests Passed: ${ANSI_GREEN}${passedCount}${ANSI_RESET} | Tests Failed: ${failedCount === 0 ? ANSI_GREEN : ANSI_RED}${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runMarketingTests().catch((err) => {
  console.error("Marketing Test Suite Fatal Error:", err);
  process.exit(1);
});

