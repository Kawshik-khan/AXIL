// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { RequestContext } from "@/lib/context";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

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

export async function runAnalyticsTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 7: ANALYTICS & BI TEST SUITE      ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_analytics_test_01";

  // Reset and seed database for deterministic test runs
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // Create test context with OWNER role and full permissions
  const testContext: RequestContext = {
    requestId: "req_test_analytics_001",
    traceId: "trace_test_001",
    user: {
      id: "user_analyst_01",
      email: "analyst@example.com",
      name: "Chief Analytics Officer",
      status: "ACTIVE",
    },
    tenant: {
      id: tenantId,
      name: "Analytics Test Commerce",
      slug: "analytics-test",
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: ROLE_PERMISSIONS["OWNER"],
    timestamp: new Date().toISOString(),
  };

  // Seed sample verified orders for the test tenant
  const order1 = db.createOrder(
    {
      id: "ord_test_01",
      tenant_id: tenantId,
      order_number: "ORD-TEST-001",
      customer_id: "cust_test_01",
      status: "DELIVERED",
      currency: "BDT",
      subtotal: 4500,
      discount_total: 300,
      shipping_total: 60,
      tax_total: 0,
      grand_total: 4260,
      payment_method: "BKASH",
      payment_status: "PAID",
      fulfillment_status: "FULFILLED",
      source: "WHATSAPP",
      notes: "WhatsApp conversational checkout",
      shipping_address_snapshot: {
        district: "Dhaka",
        division: "Dhaka",
        zone: "INSIDE_DHAKA",
        address_line_1: "Gulshan 2, Dhaka",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    []
  );

  const order2 = db.createOrder(
    {
      id: "ord_test_02",
      tenant_id: tenantId,
      order_number: "ORD-TEST-002",
      customer_id: "cust_test_02",
      status: "RETURNED",
      currency: "BDT",
      subtotal: 2800,
      discount_total: 0,
      shipping_total: 120,
      tax_total: 0,
      grand_total: 2920,
      payment_method: "COD",
      payment_status: "REFUNDED",
      fulfillment_status: "CANCELLED",
      source: "FACEBOOK",
      notes: "Facebook Messenger checkout - Doorstep refusal",
      shipping_address_snapshot: {
        district: "Cox's Bazar",
        division: "Chattogram",
        zone: "OUTSIDE_DHAKA",
        address_line_1: "Kolatoli Beach Road",
      },
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    []
  );

  // ==========================================
  // SECTION 1: DETERMINISTIC FINANCIAL METRICS
  // ==========================================
  console.log(`${ANSI_BOLD}--- 1. Deterministic Financial Metrics (Zero-Hallucination) ---${ANSI_RESET}`);

  await runTest("Computes GMV, NMV, AOV, COGS, and Gross Margin with deterministic formulas", async () => {
    const fin = await analyticsService.getFinancialMetrics(testContext, "30D");

    assert.ok(fin.gmv_bdt >= 7180, `Expected GMV >= 7180, got ${fin.gmv_bdt}`);
    assert.ok(fin.nmv_bdt <= fin.gmv_bdt, `Expected NMV <= GMV`);
    assert.ok(fin.aov_bdt > 0, `Expected AOV > 0, got ${fin.aov_bdt}`);
    assert.ok(fin.cogs_bdt > 0, `Expected COGS > 0, got ${fin.cogs_bdt}`);
    assert.ok(fin.gross_profit_bdt > 0, `Expected Gross Profit > 0, got ${fin.gross_profit_bdt}`);
    assert.ok(
      fin.gross_margin_pct >= 0 && fin.gross_margin_pct <= 100,
      `Gross Margin % must be between 0 and 100, got ${fin.gross_margin_pct}`
    );

    // Verify mathematical formula: Gross Profit = GMV - COGS
    const expectedProfit = fin.gmv_bdt - fin.cogs_bdt;
    assert.strictEqual(
      fin.gross_profit_bdt,
      expectedProfit,
      "Authoritative check: Gross Profit must strictly equal GMV - COGS"
    );

    // Verify AOV = GMV / orders_count
    const expectedAov = Math.round(fin.gmv_bdt / fin.total_orders_count);
    assert.strictEqual(fin.aov_bdt, expectedAov, "Authoritative check: AOV must equal GMV / orders_count");
  });

  await runTest("Supports all date presets: TODAY, 7D, 30D, 90D, YTD, ALL", async () => {
    const presets: Array<"TODAY" | "7D" | "30D" | "90D" | "YTD" | "ALL"> = [
      "TODAY",
      "7D",
      "30D",
      "90D",
      "YTD",
      "ALL",
    ];

    for (const preset of presets) {
      const fin = await analyticsService.getFinancialMetrics(testContext, preset);
      assert.ok(typeof fin.gmv_bdt === "number");
      assert.ok(Array.isArray(fin.time_series));
      assert.ok(fin.time_series.length > 0, `Preset ${preset} must generate time series points`);
    }
  });

  await runTest("Generates continuous daily time series data for revenue velocity visualization", async () => {
    const fin = await analyticsService.getFinancialMetrics(testContext, "7D");
    assert.ok(fin.time_series.length >= 7, `Expected at least 7 points for 7D preset, got ${fin.time_series.length}`);

    const samplePt = fin.time_series[0];
    assert.ok(samplePt.date.includes("-"));
    assert.ok(typeof samplePt.gmv_bdt === "number");
    assert.ok(typeof samplePt.aov_bdt === "number");
    assert.ok(typeof samplePt.gross_margin_pct === "number");
  });

  // ==========================================
  // SECTION 2: 64-DISTRICT RTO GEOGRAPHY
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 2. 64-District RTO Geography & Division Breakdown ---${ANSI_RESET}`);

  await runTest("Evaluates all 64 districts in Bangladesh without missing any", async () => {
    const report = await analyticsService.getRtoGeographyReport(testContext);

    assert.strictEqual(report.districts.length, 64, `Expected exactly 64 districts in Bangladesh, got ${report.districts.length}`);
    assert.strictEqual(report.divisions_summary.length, 8, `Expected exactly 8 administrative divisions, got ${report.divisions_summary.length}`);

    // Verify presence of major administrative districts
    const districtNames = report.districts.map((d) => d.district);
    assert.ok(districtNames.includes("Dhaka"));
    assert.ok(districtNames.includes("Chattogram"));
    assert.ok(districtNames.includes("Rajshahi"));
    assert.ok(districtNames.includes("Khulna"));
    assert.ok(districtNames.includes("Barishal"));
    assert.ok(districtNames.includes("Sylhet"));
    assert.ok(districtNames.includes("Rangpur"));
    assert.ok(districtNames.includes("Mymensingh"));
    assert.ok(districtNames.includes("Cox's Bazar"));
    assert.ok(districtNames.includes("Sunamganj"));
  });

  await runTest("Correctly classifies Inside Dhaka (৳60) vs Outside Dhaka (৳120) logistics zones", async () => {
    const report = await analyticsService.getRtoGeographyReport(testContext);

    const dhaka = report.districts.find((d) => d.district === "Dhaka");
    assert.ok(dhaka);
    assert.strictEqual(dhaka.zone, "INSIDE_DHAKA");

    const ctg = report.districts.find((d) => d.district === "Chattogram");
    assert.ok(ctg);
    assert.strictEqual(ctg.zone, "OUTSIDE_DHAKA");

    assert.ok(typeof report.inside_dhaka_rto_pct === "number");
    assert.ok(typeof report.outside_dhaka_rto_pct === "number");
    assert.ok(report.inside_dhaka_rto_pct < report.outside_dhaka_rto_pct, "Inside Dhaka RTO is typically lower than Outside Dhaka");
  });

  await runTest("Flags high-risk districts (>15% RTO) with mandatory partial advance bKash requirement", async () => {
    const report = await analyticsService.getRtoGeographyReport(testContext);

    const highRisk = report.districts.filter((d) => d.risk_tier === "HIGH_RISK");
    assert.ok(highRisk.length > 0, "Expected at least one high-risk district flagged");

    const coxBazar = report.districts.find((d) => d.district === "Cox's Bazar");
    assert.ok(coxBazar);
    assert.strictEqual(coxBazar.risk_tier, "HIGH_RISK");
    assert.ok(
      coxBazar.recommendation.includes("৳150 delivery advance"),
      "High-risk district must recommend ৳150 delivery advance via bKash/Nagad"
    );
  });

  await runTest("Filters 64-district report by division and district search query", async () => {
    // Division filter: Sylhet has 4 districts (Sylhet, Moulvibazar, Habiganj, Sunamganj)
    const sylhetReport = await analyticsService.getRtoGeographyReport(testContext, { division: "Sylhet" });
    assert.strictEqual(sylhetReport.districts.length, 4, `Sylhet division must contain 4 districts, got ${sylhetReport.districts.length}`);

    // Search query: "bogura"
    const searchReport = await analyticsService.getRtoGeographyReport(testContext, { search: "bogura" });
    assert.strictEqual(searchReport.districts.length, 1);
    assert.strictEqual(searchReport.districts[0].district, "Bogura");
  });

  // ==========================================
  // SECTION 3: MULTI-CHANNEL ATTRIBUTION
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 3. Multi-Channel Revenue & Conversion Attribution ---${ANSI_RESET}`);

  await runTest("Calculates omnichannel attribution across Facebook, WhatsApp, Website, Instagram, and POS", async () => {
    const report = await analyticsService.getChannelAttributionReport(testContext, "30D");

    assert.strictEqual(report.channels.length, 5, `Expected 5 channels, got ${report.channels.length}`);
    assert.ok(report.total_gmv_bdt > 0);
    assert.ok(report.total_orders_count > 0);

    const whatsapp = report.channels.find((c) => c.channel === "WHATSAPP");
    const fb = report.channels.find((c) => c.channel === "FACEBOOK_MESSENGER");
    const web = report.channels.find((c) => c.channel === "WEBSITE");

    assert.ok(whatsapp, "WhatsApp channel must be evaluated");
    assert.ok(fb, "Facebook Messenger channel must be evaluated");
    assert.ok(web, "Website storefront channel must be evaluated");

    // Check sum of GMV shares approximates 100%
    const sumGmvShares = report.channels.reduce((sum, c) => sum + c.gmv_share_pct, 0);
    assert.ok(
      Math.abs(sumGmvShares - 100) < 1.0,
      `Sum of GMV shares must be ~100%, got ${sumGmvShares}%`
    );

    // Verify WhatsApp conversational checkout has highest conversion
    assert.ok(whatsapp.conversion_rate_pct > web.conversion_rate_pct, "Conversational checkout out-converts web cart");
  });

  // ==========================================
  // SECTION 4: EXECUTIVE BUSINESS DIGESTS
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 4. Executive Business Digests & Synthesis Engine ---${ANSI_RESET}`);

  await runTest("Retrieves existing executive digests for the tenant", async () => {
    const digests = await analyticsService.getExecutiveDigests(testContext);
    assert.ok(Array.isArray(digests));
  });

  await runTest("Synthesizes a new Daily Executive Business Digest deterministically", async () => {
    const digest = await analyticsService.generateExecutiveDigest(testContext, {
      period_type: "DAILY",
    });

    assert.ok(digest.id.startsWith("ed_"));
    assert.strictEqual(digest.period_type, "DAILY");
    assert.ok(digest.title.includes("Daily"));
    assert.ok(digest.executive_summary.includes("GMV"));
    assert.strictEqual(digest.generated_by_agent, "ANALYTICS_AGENT");

    // Verify financial summary snapshot
    assert.ok(digest.financial_summary.gmv_bdt > 0);
    assert.ok(digest.financial_summary.aov_bdt > 0);
    assert.ok(digest.financial_summary.gross_margin_pct > 0);

    // Verify strategic recommendations are present
    assert.ok(Array.isArray(digest.strategic_recommendations));
    assert.ok(digest.strategic_recommendations.length >= 2);

    // Verify newly generated digest is persisted in DB
    const fetched = await analyticsService.getExecutiveDigestById(testContext, digest.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.id, digest.id);
  });

  await runTest("Synthesizes a Weekly Executive Digest with 7-day period window", async () => {
    const digest = await analyticsService.generateExecutiveDigest(testContext, {
      period_type: "WEEKLY",
    });

    assert.strictEqual(digest.period_type, "WEEKLY");
    assert.ok(digest.title.includes("Weekly"));

    const start = new Date(digest.period_start).getTime();
    const end = new Date(digest.period_end).getTime();
    const diffDays = Math.round((end - start) / 86400000);
    assert.strictEqual(diffDays, 7, `Expected weekly digest to span 7 days, got ${diffDays}`);
  });

  // ==========================================
  // TEST SUITE SUMMARY
  // ==========================================
  console.log(`\n${ANSI_BOLD}----------------------------------------------------${ANSI_RESET}`);
  console.log(`Tests Passed: ${ANSI_GREEN}${passedCount}${ANSI_RESET} | Tests Failed: ${failedCount === 0 ? ANSI_GREEN : ANSI_RED}${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runAnalyticsTests().catch((err) => {
  console.error("Analytics Test Suite Fatal Error:", err);
  process.exit(1);
});
